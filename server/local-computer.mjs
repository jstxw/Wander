// Runs Wander's tutor runtime on this computer instead of a Steel Computer VM.
// The practice browser is still an isolated Steel Browser session; only the Python runtime moves here.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { snapshotPage } from '../extension/page-tools.js';

const PYTHON_CANDIDATES = ['python3.13', 'python3.12', 'python3.11', 'python3'];

function run(command, args, { env, timeout, signal } = {}) {
  return new Promise(resolve => {
    execFile(command, args, { env, timeout, signal, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      resolve({ exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0, timedOut: Boolean(error?.killed), output: stdout });
    });
  });
}

export class LocalComputer {
  constructor({ key, root }) {
    this.key = key; this.root = root; this.python = path.join(root, 'venv', 'bin', 'python');
    this.ready = false; this.tutorReady = false; this.pending = null;
  }
  env(extra = {}) { return { PATH: process.env.PATH, HOME: process.env.HOME, WANDER_RUNTIME_ROOT: this.root, ...extra }; }
  async ensure() {
    if (this.ready) return this.publicState();
    this.pending ||= this.prepare().finally(() => { this.pending = null; });
    return this.pending;
  }
  async prepare() {
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(this.python)) await this.createEnvironment();
    this.ready = true;
    return this.publicState();
  }
  async createEnvironment() {
    const venv = path.join(this.root, 'venv');
    // Some installs ship a broken ensurepip, so try each interpreter and discard any half-built environment.
    for (const candidate of process.env.WANDER_PYTHON ? [process.env.WANDER_PYTHON] : PYTHON_CANDIDATES) {
      const supported = await run(candidate, ['-c', 'import sys; assert sys.version_info >= (3, 9)'], { env: this.env(), timeout: 10000 });
      if (supported.exitCode !== 0) continue;
      const created = await run(candidate, ['-m', 'venv', venv], { env: this.env(), timeout: 90000 });
      if (created.exitCode === 0 && fs.existsSync(this.python)) return;
      fs.rmSync(venv, { recursive: true, force: true });
    }
    throw new Error('Could not create a Python environment for the tutor. Install Python 3.9 or newer (for example, brew install python@3.12), or set WANDER_PYTHON.');
  }
  async prepareTutor() {
    if (this.tutorReady) return;
    // The practice browser is reached over CDP, so only the Playwright client is needed, not a local browser download.
    const installed = await run(this.python, ['-c', 'import playwright'], { env: this.env(), timeout: 15000 });
    if (installed.exitCode !== 0) {
      const install = await run(this.python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', 'playwright==1.58.0'], { env: this.env(), timeout: 190000 });
      if (install.exitCode !== 0 || install.timedOut) throw new Error('Could not install the tutor browser tools locally. Check your internet connection and try again.');
    }
    fs.copyFileSync(new URL('./tutor-runtime.py', import.meta.url), path.join(this.root, 'tutor.py'));
    fs.writeFileSync(path.join(this.root, 'snapshot.js'), snapshotPage.toString());
    this.tutorReady = true;
  }
  async tutor(operation, payload, runId, key, signal) {
    if (!this.tutorReady) throw new Error('Prepare the tutor workspace before running a task.');
    const result = await run(this.python, [path.join(this.root, 'tutor.py'), operation, Buffer.from(JSON.stringify(payload)).toString('base64'), runId],
      { env: this.env({ OPENAI_API_KEY: key || '', STEEL_API_KEY: this.key }), timeout: 110000, signal });
    if (result.exitCode !== 0 || result.timedOut) throw new Error('The local tutor did not finish. No paid request was retried.');
    try { return JSON.parse(result.output); } catch { throw new Error('The local tutor returned an unreadable result.'); }
  }
  tutorFetcher(key, runId) {
    return async (_url, options) => {
      const envelope = await this.tutor('plan', JSON.parse(options.body), runId, key, options.signal);
      return Response.json(envelope.data || {}, { status: envelope.status || 502 });
    };
  }
  async inspect(url, runId, signal) {
    const result = await this.tutor('inspect', { url }, runId, '', signal);
    if (result.status !== 200) throw new Error('The tutor could not inspect the practice website.');
    return result.data;
  }
  async releaseTutor(runId) {
    const result = await this.tutor('release', {}, runId);
    if (result.status !== 200) throw new Error('Could not release the practice browser. It will expire after 15 minutes.');
  }
  // Nothing to pause: there is no remote machine. Steel Browser sessions are released per task.
  async pause() {}
  publicState() { return { id: 'local', status: 'running', ready: this.ready, transport: 'This computer' }; }
}
