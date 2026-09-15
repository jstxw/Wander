import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Budget, MAX_STEPS, saveJson } from './budget.mjs';
import { allowedUrl } from './browser.mjs';
import { plan } from './planner.mjs';
import { SteelComputer } from './computer.mjs';
import { LocalComputer } from './local-computer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env.local');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const port = Number(process.env.PORT || 4318);
const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const dataDir = process.env.WANDER_DATA_DIR || path.join(root, '.wander');
const budget = new Budget(path.join(dataDir, 'budget.json'));
const pairFile = path.join(dataDir, 'extension-pair.json');
const pairing = fs.existsSync(pairFile) ? JSON.parse(fs.readFileSync(pairFile, 'utf8')) : { token: randomBytes(32).toString('hex') };
if (!fs.existsSync(pairFile)) saveJson(pairFile, pairing);
let computer = null, localStep = null;
let run = null, connecting = false, controller = null;
const logs = [];
const log = (kind, message) => {
  logs.push({ id: randomUUID(), at: Date.now(), kind, message });
  if (logs.length > 100) logs.shift();
};
const configured = () => Boolean(process.env.OPENAI_API_KEY && process.env.STEEL_API_KEY);
function state() {
  let practice = null;
  if (run?.workspace) {
    const w = run.workspace;
    let viewerUrl = null;
    try { const u = new URL(w.viewerUrl); if (u.protocol === 'https:' && (u.hostname === 'steel.dev' || u.hostname.endsWith('.steel.dev'))) { u.searchParams.set('interactive', 'false'); viewerUrl = u.href; } } catch {}
    practice = { phase: w.phase, rehearsed: Boolean(w.rehearsed), title: w.shadowTitle || '', viewerUrl,
      decisions: w.decisions || 0, exploredPages: w.exploredPages || 0, learnedRoutes: w.learnedRoutes || 0, limitation: w.limitation || null, artifacts: w.artifacts || [], hasEvidence: Boolean(w.screenshot) };
  }
  return { configured: configured(), keys: { openai: Boolean(process.env.OPENAI_API_KEY), steel: Boolean(process.env.STEEL_API_KEY), elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY) },
    practice,
    budget: budget.publicState(), session: null, computer: computer?.publicState() || null, connecting,
    run: run ? { id: run.id, mode: run.mode || 'local', tutor: Boolean(run.tutor), phase: run.phase, model: run.model, modelMode: run.modelMode, task: run.task, status: run.status, message: run.message, steps: run.steps, maxSteps: MAX_STEPS, spent: run.spent } : null,
    logs };
}
function safeError(error) {
  let text = error?.message || 'Something went wrong.';
  for (const key of [process.env.OPENAI_API_KEY, process.env.STEEL_API_KEY, process.env.ELEVENLABS_API_KEY]) if (key) text = text.split(key).join('[redacted]');
  return text.replace(/(?:https?|wss?):\/\/\S+/g, '[browser URL]').slice(0, 600);
}
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }
async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 60000) throw new Error('Request too large.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
async function streamSpeech(res, body) {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('Add an ElevenLabs API key in Wander Settings to use this voice.');
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 1000) throw new Error('Voice text must be between 1 and 1,000 characters.');
  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'cjVigY5qzO86Huf0OWal';
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5', voice_settings: { stability: 0.48, similarity_boost: 0.75, speed: 1.04 } }),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok || !response.body) throw new Error(`ElevenLabs voice request failed (HTTP ${response.status}). Check your key and voice access.`);
  res.writeHead(200, { 'Content-Type': response.headers.get('content-type')?.split(';')[0] || 'audio/mpeg', 'Transfer-Encoding': 'chunked' });
  await pipeline(Readable.fromWeb(response.body), res);
}
// A run's practice-browser jobs (inspect, rehearse, release) share one Steel session and state file, so they run one at a time.
function practice(task, work) {
  task.practiceQueue = (task.practiceQueue || Promise.resolve()).then(work, work);
  return task.practiceQueue;
}
const samePage = (a, b) => { try { const x = new URL(a), y = new URL(b); return x.origin === y.origin && x.pathname === y.pathname; } catch { return false; } };
function releasePractice(task) {
  practice(task, () => computer?.releaseTutor(task.id))
    .then(() => { if (task.workspace) { task.workspace.viewerUrl = null; task.workspace.phase = 'ended'; } })
    .catch(error => log('info', safeError(error)));
}

async function stop(status) {
  if (run && ['running', 'waiting', 'paused'].includes(run.status)) {
    run.status = status; run.message = status === 'paused' ? 'You’re in control. Say “Hello Wander, resume” when you’re ready.' : 'Task stopped.';
    controller?.abort();
    await localStep;
    log('info', run.message);
  }
  if (status === 'stopped' && run?.tutor) releasePractice(run);
}

async function localRequest(endpoint, body) {
  if (endpoint === 'state') return state();
  if (endpoint === 'connect') {
    if (!configured()) throw new Error('Save your keys in the Wander workspace first.');
    if (connecting) throw new Error('The tutor is already starting.');
    connecting = true;
    try {
      // Steel Computer is opt-in. By default the tutor runtime runs here and only the practice browser uses Steel.
      computer ||= process.env.WANDER_RUNNER === 'steel'
        ? new SteelComputer({ key: process.env.STEEL_API_KEY, stateFile: path.join(dataDir, 'computer.json') })
        : new LocalComputer({ key: process.env.STEEL_API_KEY, root: path.join(dataDir, 'runtime') });
      await computer.ensure();
      log('info', `Preparing the tutor workspace and browser tools on ${computer instanceof LocalComputer ? 'this computer' : 'Steel Computer'}…`);
      await computer.prepareTutor();
      log('success', 'Tutor workspace ready. You stay in control of every click.');
      return state();
    } finally { connecting = false; }
  }
  if (endpoint === 'start') {
    if (localStep || connecting || run?.status === 'running') throw new Error('Stop or resume the existing task first.');
    if (!computer?.ready) throw new Error('Prepare the tutor workspace first.');
    const task = typeof body.task === 'string' ? body.task.trim() : '';
    if (!task || task.length > 1500) throw new Error('Enter a short task, up to 1,500 characters.');
    if (run?.tutor) releasePractice(run);
    run = { id: randomUUID(), mode: 'local', modelMode: ['dynamic', 'low', 'high'].includes(body.modelMode) ? body.modelMode : 'dynamic', task, status: 'running', message: 'Reading your tab…', spent: 0, steps: 0, history: [], memory: Array.isArray(body.memory) ? body.memory.slice(-8).map(item => ({ page: String(item.page || '').slice(0, 500), task: String(item.task || '').slice(0, 1500), status: String(item.status || '').slice(0, 30), outcome: String(item.outcome || '').slice(0, 1000) })) : [], pendingAction: null };
    run.tutor = true; run.phase = 'exploring';
    run.message = 'Wander is opening a separate browser to understand this website…';
    controller = new AbortController(); log('user', task); return state();
  }
  if (!run || run.mode !== 'local' || body.runId !== run.id) throw new Error('This task is no longer active.');
  if (endpoint === 'pause' || endpoint === 'stop') { await stop(endpoint === 'pause' ? 'paused' : 'stopped'); return state(); }
  if (endpoint === 'resume') {
    if (localStep || !['paused', 'waiting'].includes(run.status)) throw new Error('Pause the task before resuming.');
    if (run.steps >= MAX_STEPS) throw new Error('Step limit reached. Stop and start a new task.');
    const answer = typeof body.answer === 'string' ? body.answer.trim().slice(0, 1000) : '';
    if (answer) { run.task = `${run.task}\nUser clarification: ${answer}`.slice(-4000); log('user', answer); }
    run.pendingAction = null; run.loadingWait = null; run.waitCount = 0;
    run.history.push({ result: 'User reviewed the page and resumed. Reobserve before taking any action.' });
    run.status = 'running'; run.message = 'Continuing in your tab…'; controller = new AbortController(); return state();
  }
  if (endpoint === 'result') {
    if (body.actionId !== run.pendingAction?.id) throw new Error('Action acknowledgement does not match.');
    if (run.pendingAction.action !== 'wait') run.history.push({ action: run.pendingAction.action, message: run.pendingAction.message, result: body.ok ? 'User interacted with the highlighted control. Verify the outcome in the next observation; do not assume success.' : 'User navigated or requested another look. Reobserve and adapt; do not assume completion.' });
    run.pendingAction = null;
    return state();
  }
  if (endpoint === 'step') {
    if (localStep || run.status !== 'running') throw new Error('The agent is paused or already deciding.');
    if (run.pendingAction) { run.status = 'waiting'; run.message = 'The last action was not confirmed. Inspect your page before resuming.'; return { state: state(), action: null }; }
    if (run.steps >= MAX_STEPS) { run.status = 'limited'; run.message = 'Reached the 60-action limit. Review the page before starting a new task.'; return { state: state(), action: null }; }
    const observation = body.observation;
    if (!observation || typeof observation.url !== 'string' || typeof observation.text !== 'string' || !Array.isArray(observation.elements)) throw new Error('Invalid page observation.');
    if (observation.text.length > 7000 || observation.elements.length > 65) throw new Error('Page observation too large.');
    if (!allowedUrl(observation.url)) {
      run.status = 'waiting'; run.message = 'Open an ordinary HTTP/HTTPS website to start.'; return { state: state(), action: null };
    }
    const fingerprint = JSON.stringify(observation);
    if (run.loadingWait) {
      if (run.loadingWait.fingerprint === fingerprint && Date.now() < run.loadingWait.until) {
        const action = { id: randomUUID(), action: 'wait', target: 0, value: '', message: 'Waiting for the page to change…' };
        run.pendingAction = action;
        return { state: state(), action };
      }
      run.loadingWait = null;
    }
    const active = run;
    localStep = (async () => {
      try {
        const started = Date.now(), signal = controller.signal;
        active.phase = 'exploring'; active.message = 'Choosing your next step…';
        // Decide from the learner's real tab right away. The practice browser inspects in parallel,
        // and its evidence informs later steps on the same page instead of delaying this one.
        if (!samePage(active.evidence?.url, observation.url)) active.evidence = null;
        log('info', 'Inspecting the public page in the practice browser and saving evidence.');
        practice(active, () => computer.inspect(observation.url, active.id, signal))
          .then(inspected => { active.evidence = inspected.evidence; active.workspace = inspected.workspace; })
          .catch(error => { if (!signal.aborted) log('info', safeError(error)); });
        const action = await plan({ key: process.env.OPENAI_API_KEY, task: active.task, observation, history: active.history, budget, run: active, signal });
        if (active.status !== 'running') return { state: state(), action: null };
        log('info', `Next step chosen in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
        // Rehearse after the highlight is shown; the learner never waits on the practice browser.
        const target = observation.elements.find(element => element.id === action.target) || null;
        practice(active, () => computer.tutor('rehearse', { action: { action: action.action, value: action.value, message: action.message }, target, url: observation.url, recentActions: active.history.slice(-5) }, active.id, '', signal))
          .then(result => {
            if (result?.status !== 200) return;
            active.workspace = result.data;
            if (['click', 'scroll'].includes(action.action)) log('info', result.data.rehearsed ? 'Public navigation rehearsed in the practice browser.' : 'Guidance is anchored to your tab. This action was not rehearsed.');
          })
          .catch(error => { if (!signal.aborted) log('info', safeError(error)); });
        if (action.action === 'wait') {
          active.waitCount = (active.waitCount || 0) + 1;
          if (active.waitCount >= 3) {
            active.status = 'waiting'; active.message = 'The page is not becoming usable. Check for a loading error or embedded configurator, then say “Hello Wander, resume”. Your progress is preserved.';
            return { state: state(), action: null };
          }
          active.loadingWait = { fingerprint, until: Date.now() + 30000 };
        } else { active.steps++; active.waitCount = 0; }
        active.message = action.message;
        if (action.action === 'done' || action.action === 'ask') {
          active.status = action.action === 'done' ? 'done' : 'waiting'; log(action.action === 'done' ? 'success' : 'question', action.message);
          active.phase = action.action === 'done' ? 'complete' : 'needs-you';
          if (action.action === 'done') releasePractice(active);
          return { state: state(), action: null };
        }
        active.phase = 'your-turn';
        action.id = randomUUID(); active.pendingAction = action; log('action', action.message);
        return { state: state(), action };
      } catch (error) {
        if (active.status === 'running') { active.status = 'error'; active.message = safeError(error); log('error', active.message); }
        return { state: state(), action: null };
      }
    })();
    try { return await localStep; } finally { localStep = null; }
  }
  throw new Error('Unknown current-tab action.');
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-src https://*.steel.dev; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if (!hosts.has(req.headers.host)) return json(res, 403, { error: 'Local access only.' });
  if (req.url?.startsWith('/api/local/')) {
    const origin = req.headers.origin;
    if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin) && !origins.has(origin)) return json(res, 403, { error: 'Extension access only.' });
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method !== 'POST' || req.headers.authorization !== `Bearer ${pairing.token}`) return json(res, 403, { error: 'Pair this extension with Wander first.' });
    try {
      const endpoint = req.url.slice('/api/local/'.length);
      const body = await readBody(req);
      if (endpoint === 'speech') return await streamSpeech(res, body);
      return json(res, 200, await localRequest(endpoint, body));
    }
    // A response already streaming (speech cut off mid-audio) can only be closed; falling through would write a second response and crash the server.
    catch (error) { if (!res.headersSent) return json(res, 400, { error: safeError(error) }); res.destroy(); return; }
  }
  if (req.headers.origin && !origins.has(req.headers.origin)) return json(res, 403, { error: 'Cross-origin requests are not allowed.' });
  if (req.headers['sec-fetch-site'] === 'cross-site' && req.url?.startsWith('/api/')) return json(res, 403, { error: 'Local access only.' });
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, state());
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      if (req.headers['x-wander-request'] !== '1' || !req.headers['content-type']?.startsWith('application/json')) return json(res, 403, { error: 'Invalid local request.' });
      const body = await readBody(req);
      if (url.pathname === '/api/extension-token') return json(res, 200, { token: pairing.token });
      if (url.pathname === '/api/evidence') {
        if (!run?.tutor || !computer?.ready) throw new Error('There is no practice evidence yet.');
        const result = await computer.tutor('evidence', {}, run.id);
        if (result.status !== 200) throw new Error('The screenshot is unavailable or too large. Use the live practice view.');
        return json(res, 200, result.data);
      }
      if (url.pathname === '/api/setup') {
        if (connecting || localStep || ['running', 'paused', 'waiting'].includes(run?.status)) throw new Error('End the active session before updating keys.');
        const openai = body.openai || process.env.OPENAI_API_KEY;
        const steel = body.steel || process.env.STEEL_API_KEY;
        const elevenlabs = body.elevenlabs || process.env.ELEVENLABS_API_KEY || '';
        const elevenlabsVoice = /^[A-Za-z0-9_-]{8,64}$/.test(process.env.ELEVENLABS_VOICE_ID || '') ? process.env.ELEVENLABS_VOICE_ID : '';
        if (typeof openai !== 'string' || !/^sk-[A-Za-z0-9_\-]{16,}$/.test(openai) || typeof steel !== 'string' || !/^ste[-_][A-Za-z0-9_\-]{12,}$/.test(steel)) throw new Error('Enter valid OpenAI (sk-…) and Steel (ste-…) keys.');
        if (elevenlabs && (typeof elevenlabs !== 'string' || elevenlabs.length < 16 || /\s/.test(elevenlabs))) throw new Error('Enter a valid ElevenLabs API key, or leave it blank.');
        if (fs.existsSync(envFile) && fs.lstatSync(envFile).isSymbolicLink()) throw new Error('Cannot save to a symlink.');
        fs.writeFileSync(`${envFile}.tmp`, `OPENAI_API_KEY=${openai}\nSTEEL_API_KEY=${steel}\n${elevenlabs ? `ELEVENLABS_API_KEY=${elevenlabs}\n` : ''}${elevenlabsVoice ? `ELEVENLABS_VOICE_ID=${elevenlabsVoice}\n` : ''}`, { mode: 0o600 });
        fs.renameSync(`${envFile}.tmp`, envFile);
        process.env.OPENAI_API_KEY = openai; process.env.STEEL_API_KEY = steel;
        if (elevenlabs) process.env.ELEVENLABS_API_KEY = elevenlabs; else delete process.env.ELEVENLABS_API_KEY;
        computer = null;
        log('success', 'Keys saved locally. Connect your browser to begin.');
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/connect') { return json(res, 200, await localRequest('connect', {})); }
      if (url.pathname === '/api/run') throw new Error('Ask from the Wander extension or its linked workspace to highlight actions in your website tab.');
      if (url.pathname === '/api/pause') { await stop('paused'); return json(res, 200, state()); }
      if (url.pathname === '/api/stop') { await stop('stopped'); return json(res, 200, state()); }
      if (url.pathname === '/api/resume') throw new Error('Resume this question from the floating Wander panel on your website.');
      if (url.pathname === '/api/release') {
        if (connecting) throw new Error('Wait for the browser to finish starting.');
        await stop('stopped'); log('info', 'Question ended. Practice evidence remains on the tutor computer.');
        return json(res, 200, state());
      }
      return json(res, 404, { error: 'Unknown action.' });
    }
    const files = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/tutor.css': 'tutor.css', '/favicon.svg': 'favicon.svg' };
    const file = files[url.pathname];
    if (req.method !== 'GET' || !file) return json(res, 404, { error: 'Not found.' });
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', `${types[path.extname(file)]}; charset=utf-8`);
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(path.join(root, 'public', file)).pipe(res);
  } catch (error) { json(res, 400, { error: safeError(error) }); }
});
server.listen(port, '127.0.0.1', () => console.log(`Wander is ready at http://127.0.0.1:${port}`));
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : 'Could not start local server.'); process.exit(1); });
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return; shuttingDown = true;
  const timer = setTimeout(() => process.exit(1), 12000); timer.unref();
  await stop('stopped');
  await computer?.pause().catch(() => {});
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
