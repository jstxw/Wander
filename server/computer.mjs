import fs from 'node:fs';
import { saveJson } from './budget.mjs';
import { snapshotPage } from '../extension/page-tools.js';

// This runtime executes on Steel Computer, not on the user's laptop. The API key
// is supplied only in the exec environment; it is never written into the script or logs.
const runtime = `import os, sys, json, urllib.request, urllib.error, base64, pathlib, time
body = json.loads(base64.b64decode(sys.argv[1]))
run_id = sys.argv[2]
directory = pathlib.Path('/tmp/wander-agent')
directory.mkdir(mode=0o700, exist_ok=True)
request = urllib.request.Request('https://api.openai.com/v1/chat/completions', data=json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + os.environ['OPENAI_API_KEY'], 'Content-Type':'application/json'})
try:
    with urllib.request.urlopen(request, timeout=22) as response:
        data = json.load(response)
        # Persist a compact decision record on the Steel computer, without page content or credentials.
        record = {'at':time.time(), 'model':body['model'], 'usage':data.get('usage'), 'decision':data.get('choices',[{}])[0].get('message',{}).get('content')}
        with (directory / (run_id + '.jsonl')).open('a') as log:
            log.write(json.dumps(record) + '\\n')
        print(json.dumps({'status':200, 'data':data}))
except urllib.error.HTTPError as error:
    print(json.dumps({'status':error.code}))
except Exception:
    print(json.dumps({'status':502}))
`;

export class SteelComputer {
  constructor({ key, stateFile }) { this.key = key; this.stateFile = stateFile; this.computer = null; this.ready = false; this.pending = null; }
  async api(endpoint, method = 'GET', body, signal) {
    const response = await fetch(`https://api.steel.dev/v1${endpoint}`, {
      method, headers: { 'steel-api-key': this.key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: signal || AbortSignal.timeout(endpoint.endsWith('/resume') ? 15000 : 45000)
    });
    if (!response.ok) {
      const operation = endpoint.endsWith('/exec') ? 'command execution' : method === 'GET' ? 'status check' : endpoint.split('/').at(-1);
      const hint = response.status >= 500 ? 'Steel’s gateway could not complete the request. Try again shortly.' : response.status === 401 || response.status === 403 ? 'Check your Steel key and Computer beta access.' : response.status === 402 ? 'Check your Steel compute credits.' : 'Check the computer status in Steel.';
      const error = new Error(`Steel Computer ${operation} returned HTTP ${response.status}. ${hint}`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? {} : response.json();
  }
  async ensure() {
    if (this.pending) return this.pending;
    this.pending = this.prepare().catch(async error => {
      // Do not issue stop while Steel is waking: that races its lifecycle and returns 409.
      if (!this.computer?.id) throw error;
      for (let attempt = 0; attempt < 10; attempt++) {
        const latest = await this.api(`/computers/${this.computer.id}`).catch(() => null);
        if (!latest) throw error;
        this.computer = latest;
        if (latest.status === 'running') { this.ready = false; return this.prepare(); }
        if (!['waking', 'creating', 'starting'].includes(latest.status)) throw error;
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      throw new Error('Steel is still waking. Wait briefly and retry; Wander has not stopped or replaced the computer.');
    }).finally(() => this.pending = null);
    return this.pending;
  }
  async prepare() {
    if (!this.computer && fs.existsSync(this.stateFile)) this.computer = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
    if (this.computer?.id) {
      try { this.computer = await this.api(`/computers/${this.computer.id}`); }
      catch (error) {
        if (error.status !== 404) throw error;
        // Only confirmed deletion permits replacement; gateway failures must not create duplicates.
        this.computer = null; this.ready = false;
        fs.rmSync(this.stateFile, { force: true });
      }
    }
    if (this.computer?.id) {
      if (['paused', 'stopped'].includes(this.computer.status)) {
        const operation = this.computer.status === 'paused' ? 'resume' : 'start';
        try { await this.api(`/computers/${this.computer.id}/${operation}`, 'POST', {}); }
        catch (error) {
          // A beta gateway can fail after accepting a wake request. Reconcile state, don't create another VM.
          let latest;
          for (let attempt = 0; attempt < 6; attempt++) {
            latest = await this.api(`/computers/${this.computer.id}`);
            if (['running', 'waking', 'creating'].includes(latest.status)) break;
            if (error.status < 500) break;
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
          if (!['running', 'waking', 'creating'].includes(latest.status)) {
            if (operation !== 'resume' || !(error.status >= 500) || latest.status !== 'paused') throw error;
            // The beta exec gateway can wake a paused VM when explicit resume fails.
            // Probe only: never send a paid model call during recovery.
            const probe = await this.probe();
            if (probe.exitCode !== 0) throw error;
          }
        }
        this.ready = false;
      }
      else if (['deleted', 'failed'].includes(this.computer.status)) throw new Error('The saved Steel Computer is unavailable. Check its status in Steel.');
    } else {
      this.computer = await this.api('/computers', 'POST', { name: 'Wander current-tab agent', vcpu: 1, memoryMib: 512, timeoutSeconds: 3600, autoPause: true, idleTimeoutSeconds: 900 });
      saveJson(this.stateFile, { id: this.computer.id });
    }
    for (let count = 0; count < 60; count++) {
      this.computer = await this.api(`/computers/${this.computer.id}`);
      if (this.computer.status === 'running') break;
      if (['failed', 'deleted'].includes(this.computer.status)) throw new Error('Steel Computer failed to start.');
      if (['paused', 'stopped'].includes(this.computer.status) && count >= 3) throw new Error('Steel returned to a paused state while waking.');
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    if (this.computer.status !== 'running') throw new Error('Steel Computer is taking longer to start. Try connecting again shortly.');
    if (!this.ready) {
      this.tutorReady = false;
      let result;
      // Read-only readiness probes can retry; model requests below never do.
      for (let attempt = 0; attempt < 5; attempt++) {
        try { result = await this.exec({ argv: ['sh', '-c', 'command -v python3'], timeoutSeconds: 10 }); break; }
        catch (error) { if (attempt === 4) throw error; await new Promise(resolve => setTimeout(resolve, 1200)); }
      }
      if (result.exitCode !== 0) {
        result = await this.exec({ argv: ['sh', '-c', 'apt-get update -qq && apt-get install -y -qq python3 ca-certificates'], timeoutSeconds: 120 }, AbortSignal.timeout(130000));
        if (result.exitCode !== 0) throw new Error('Could not install Python in Steel Computer.');
      }
      const encoded = Buffer.from(runtime).toString('base64');
      // Writing the same runtime is idempotent, so a gateway failure can safely retry.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          result = await this.exec({ argv: ['python3', '-c', "import pathlib,base64,sys; p=pathlib.Path('/tmp/wander-agent'); p.mkdir(mode=0o700,exist_ok=True); (p/'step.py').write_bytes(base64.b64decode(sys.argv[1]))", encoded], timeoutSeconds: 10 });
          break;
        } catch (error) {
          if (!(error.status >= 500) || attempt === 2) throw error;
          await new Promise(resolve => setTimeout(resolve, 1200));
        }
      }
      if (result.exitCode !== 0) throw new Error('Could not prepare the Steel agent runtime.');
      this.ready = true;
    }
    return this.publicState();
  }
  exec(body, signal) { return this.api(`/computers/${this.computer.id}/exec`, 'POST', { ...body, stream: false }, signal); }
  async probe() {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this.exec({ argv: ['sh', '-c', 'command -v python3'], timeoutSeconds: 10 }); }
      catch (error) {
        if (!(error.status >= 500) || attempt === 2) {
          this.ready = false;
          throw new Error(`Steel Computer could not wake for a readiness check${error.status ? ` (HTTP ${error.status})` : ''}. Your task has not started; no model call was sent.`);
        }
        await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
      }
    }
  }
  fetcher(key, runId) {
    return async (_url, options) => {
      if (!this.ready) throw new Error('Connect Steel Computer before running a task.');
      const encoded = Buffer.from(options.body).toString('base64');
      const result = await this.exec({ argv: ['python3', '/tmp/wander-agent/step.py', encoded, runId], env: { OPENAI_API_KEY: key }, timeoutSeconds: 27 }, options.signal);
      if (result.exitCode !== 0 || result.timedOut || result.truncated) throw new Error('The Steel agent step did not complete. No retry was made.');
      let envelope; try { envelope = JSON.parse(result.output); } catch { throw new Error('Unexpected response from Steel Computer.'); }
      return Response.json(envelope.data || {}, { status: Number.isInteger(envelope.status) ? envelope.status : 502 });
    };
  }
  async prepareTutor() {
    if (this.tutorReady) return;
    const install = await this.exec({ argv: ['sh', '-c', 'python3 -m venv /tmp/wander-agent/venv || (apt-get update -qq && apt-get install -y -qq python3-venv && python3 -m venv /tmp/wander-agent/venv); /tmp/wander-agent/venv/bin/pip install --disable-pip-version-check playwright==1.58.0'], timeoutSeconds: 180 }, AbortSignal.timeout(190000));
    if (install.exitCode !== 0 || install.timedOut) throw new Error('Could not install the tutor browser tools on Steel Computer.');
    const files = {
      'tutor.py': fs.readFileSync(new URL('./tutor-runtime.py', import.meta.url), 'utf8'),
      'snapshot.js': snapshotPage.toString()
    };
    const result = await this.exec({ argv: ['python3', '-c', "import pathlib,json,base64,sys; p=pathlib.Path('/tmp/wander-agent'); [(p/k).write_text(v) for k,v in json.loads(base64.b64decode(sys.argv[1])).items()]", Buffer.from(JSON.stringify(files)).toString('base64')], timeoutSeconds: 15 });
    if (result.exitCode !== 0) throw new Error('Could not prepare the remote tutor workspace.');
    this.tutorReady = true;
  }
  async tutor(operation, payload, runId, key, signal) {
    const result = await this.exec({ argv: ['/tmp/wander-agent/venv/bin/python', '/tmp/wander-agent/tutor.py', operation, Buffer.from(JSON.stringify(payload)).toString('base64'), runId],
      env: { OPENAI_API_KEY: key || '', STEEL_API_KEY: this.key }, timeoutSeconds: 100 }, signal || AbortSignal.timeout(110000));
    if (result.exitCode !== 0 || result.timedOut || result.truncated) throw new Error('The remote tutor did not finish. No paid request was retried.');
    let envelope;
    try { envelope = JSON.parse(result.output); } catch { throw new Error('The remote tutor returned an unreadable result.'); }
    return envelope;
  }
  tutorFetcher(key, runId) {
    return async (_url, options) => {
      const envelope = await this.tutor('plan', JSON.parse(options.body), runId, key, options.signal);
      return Response.json(envelope.data || {}, { status: envelope.status || 502 });
    };
  }
  async inspect(url, runId, signal) {
    const result = await this.tutor('inspect', { url }, runId, '', signal);
    if (result.status !== 200) throw new Error('Steel Computer could not inspect the practice website.');
    return result.data;
  }
  async releaseTutor(runId) {
    const result = await this.tutor('release', {}, runId);
    if (result.status !== 200) throw new Error('Could not release the practice browser. It will expire after 15 minutes.');
  }
  async pause() {
    if (this.computer?.id) {
      const latest = await this.api(`/computers/${this.computer.id}`);
      if (latest.status === 'running') { await this.api(`/computers/${this.computer.id}/pause`, 'POST', {}); latest.status = 'paused'; }
      this.computer = latest; this.ready = false; this.tutorReady = false;
    }
  }
  publicState() { return this.computer ? { id: this.computer.id, status: this.computer.status, ready: this.ready, transport: 'Steel Computer' } : null; }
}
