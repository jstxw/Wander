import { snapshotPage } from './page-tools.js';
import { showGuidance, clearGuidance } from './guidance.js';
const SERVER = 'http://127.0.0.1:4318';
let looping = false, preparing = false, acknowledging = false;
let offscreenCreating = null;
let speechClaimQueue = Promise.resolve();
const isWebUrl = value => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; } };
async function request(endpoint, body = {}) {
  const { token } = await chrome.storage.local.get('token');
  if (!token) throw new Error('Connect Wander once to pair this extension.');
  let response;
  try { response = await fetch(`${SERVER}/api/local/${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new Error('Wander’s local server is offline. Start Wander.command, then try again.'); }
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Agent request failed.'); return data;
}
async function inject(tabId) { await chrome.scripting.executeScript({ target: { tabId }, files: ['overlay.js'] }); }
async function remember(tabId, state) {
  if (!state?.run || state.run.mode !== 'local') return;
  const key = `memory:${tabId}`;
  const saved = (await chrome.storage.session.get(key))[key] || [];
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  let page = ''; try { const url = new URL(tab.url); page = url.origin + url.pathname; } catch {}
  const entry = { runId: state.run.id, page, task: state.run.task.slice(0, 600), status: state.run.status, outcome: state.run.message.slice(0, 500) };
  const previous = saved.filter(item => item.runId !== entry.runId || item.page !== page);
  await chrome.storage.session.set({ [key]: [...previous, entry].slice(-8) });
}
async function notify(tabId, state, error) {
  await remember(tabId, state);
  const active = await control();
  if (active?.tabId === tabId && state?.run?.id === active.runId) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    await setControl({ ...active, page: tab?.url });
  }
  try { await chrome.tabs.sendMessage(tabId, { type: 'WANDER_STATE', state, error }); } catch { /* Page is navigating. */ }
}
async function control() { return (await chrome.storage.session.get('control')).control; }
async function setControl(value) { await chrome.storage.session.set({ control: value }); }
async function clearTab(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: clearGuidance }).catch(() => {});
}
async function offscreenReady() {
  const url = chrome.runtime.getURL('offscreen.html');
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
  if (contexts.length) return;
  offscreenCreating ||= chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: 'Play Wander voice guidance without opening a window or requesting local-device access from websites.' }).finally(() => { offscreenCreating = null; });
  await offscreenCreating;
}
async function offscreenExists() {
  const url = chrome.runtime.getURL('offscreen.html');
  return (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] })).length > 0;
}
async function cancelOffscreenSpeech() {
  if (await offscreenExists()) await chrome.runtime.sendMessage({ target: 'wander-offscreen', type: 'CANCEL_SPEECH' }).catch(() => {});
}
async function claimSpeech(id) {
  let claimed = false;
  const check = speechClaimQueue.then(async () => {
    const { lastWanderSpeech } = await chrome.storage.session.get('lastWanderSpeech');
    const now = Date.now();
    claimed = lastWanderSpeech?.id !== id || now - Number(lastWanderSpeech.at || 0) > 120000;
    if (claimed) await chrome.storage.session.set({ lastWanderSpeech: { id, at: now } });
  });
  speechClaimQueue = check.catch(() => {});
  await check;
  return claimed;
}
async function acknowledge(active, ok) {
  if (acknowledging) return;
  acknowledging = true;
  try {
  const current = await control();
  if (current?.status !== 'running' || !current.pending || current.pending.id !== active.pending?.id) return;
  await setControl({ ...current, pending: null });
  await clearTab(current.tabId);
  const updated = await request('result', { runId: current.runId, actionId: active.pending.id, ok });
  await notify(current.tabId, updated);
  runLoop();
  } finally { acknowledging = false; }
}
async function runLoop() {
  if (looping) return; looping = true;
  let active;
  try {
    while ((active = await control())?.status === 'running' && !active.pending) {
      const frames = await chrome.scripting.executeScript({ target: { tabId: active.tabId, allFrames: true }, func: snapshotPage });
      const usable = frames.filter(f => f.result && isWebUrl(f.result.url));
      const top = usable.find(f => f.frameId === 0) || usable[0];
      if (!top) throw new Error('No readable website frame.');
      const targets = new Map(), elements = [];
      // Interleave frames so a navigation-heavy outer shell cannot hide its embedded app.
      for (let row = 0; row < 65 && elements.length < 65; row++) for (const f of usable) {
        const el = f.result.elements[row]; if (!el || elements.length >= 65) continue;
        const id = elements.length + 1; targets.set(id, { frame: f, localId: el.id });
        elements.push({ ...el, id, frameUrl: f.result.url });
      }
      const frame = { result: { ...top.result, elements, text: usable.map(f => `[Frame ${f.frameId}] ${f.result.text.slice(0, Math.floor(6000 / usable.length))}`).join('\n').slice(0, 6500) } };
      const response = await request('step', { runId: active.runId, observation: frame.result });
      await notify(active.tabId, response.state);
      if (!response.action) { await setControl({ ...await control(), status: response.state.run?.status || 'stopped' }); break; }
      const latest = await control();
      if (latest?.status !== 'running' || latest.runId !== active.runId) break;
      const action = response.action;
      if (action.action === 'wait') {
        await new Promise(resolve => setTimeout(resolve, 2500));
        await request('result', { runId: active.runId, actionId: action.id, ok: true });
        continue;
      }
      const chosen = targets.get(action.target);
      const destination = chosen?.frame || top;
      const localAction = chosen ? { ...action, target: chosen.localId } : action;
      await setControl({ ...latest, pending: { id: action.id, frameId: destination.frameId } });
      const [result] = await chrome.scripting.executeScript({ target: { tabId: active.tabId, frameIds: [destination.frameId] }, func: showGuidance, args: [{ action: localAction, observation: destination.result, runId: active.runId }] });
      if ((await control())?.status !== 'running') { await clearTab(active.tabId); break; }
      if (!result.result?.ok) throw new Error('The highlighted control changed. Say “Hello Wander, resume” to take another look.');
      break; // No polling or paid decisions while the learner considers the highlighted step.
    }
  } catch (error) {
    if (active) {
      await setControl({ ...active, status: 'paused' });
      const pausedState = await request('pause', { runId: active.runId }).catch(() => null);
      await notify(active.tabId, pausedState, error.message);
    }
  } finally { looping = false; }
}
chrome.action.onClicked.addListener(async tab => {
  try { await inject(tab.id); }
  catch { await chrome.tabs.create({ url: `${SERVER}/?pair=${chrome.runtime.id}` }); }
});
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status === 'loading') {
    const active = await control();
    if (active?.tabId === tabId) await cancelOffscreenSpeech();
    return;
  }
  if (info.status !== 'complete') return;
  const active = await control();
  if (active?.tabId === tabId) {
    await inject(tabId).catch(() => {});
    if (active.status === 'running') {
      if (active.pending) await acknowledge(active, false).catch(() => {});
      else runLoop();
    }
  }
});
chrome.tabs.onRemoved.addListener(async tabId => {
  await chrome.storage.session.remove(`memory:${tabId}`);
  const active = await control();
  if (active?.tabId === tabId) { await setControl({ ...active, status: 'stopped' }); await request('stop', { runId: active.runId }).catch(() => {}); }
});
async function startTutor(tabId, message) {
  const existingControl = await control();
  if (preparing || looping || existingControl?.status === 'running') throw new Error('Pause or stop the current question first.');
  const tab = await chrome.tabs.get(tabId);
  if (!isWebUrl(tab.url) || tab.url.startsWith(SERVER)) throw new Error('Open Wander on the website you want to learn first.');
  preparing = true;
  try {
    await notify(tabId, null, 'Preparing your tutor…');
    const serverState = await request('state');
    if (['running', 'paused', 'waiting'].includes(serverState.run?.status)) {
      await request('stop', { runId: serverState.run.id });
    }
    await request('connect');
    const saved = (await chrome.storage.session.get(`memory:${tabId}`))[`memory:${tabId}`] || [];
    const url = new URL(tab.url);
    const memory = saved.filter(item => item.page === url.origin + url.pathname);
    const state = await request('start', { task: message.task, modelMode: message.modelMode, memory });
    await remember(tabId, state);
    await setControl({ tabId, runId: state.run.id, status: 'running', page: tab.url });
    runLoop(); return { state };
  } finally { preparing = false; }
}
chrome.runtime.onMessageExternal.addListener((message, sender, reply) => {
  if (sender.url?.startsWith(`${SERVER}/`) && message.type === 'WANDER_PAIR' && /^[a-f0-9]{64}$/.test(message.token || '')) {
    chrome.storage.local.set({ token: message.token }).then(() => reply({ ok: true })); return true;
  }
  if (sender.url?.startsWith(`${SERVER}/`) && message.type === 'WANDER_GET_PREFERENCES') {
    chrome.storage.local.get(['modelMode', 'voiceURI']).then(reply, error => reply({error:error.message})); return true;
  }
  if (sender.url?.startsWith(`${SERVER}/`) && message.type === 'WANDER_SET_PREFERENCES') {
    if (!['dynamic','low','high'].includes(message.modelMode) || typeof message.voiceURI !== 'string' || message.voiceURI.length > 500) { reply({error:'Invalid model or voice.'}); return; }
    chrome.storage.local.set({modelMode:message.modelMode,voiceURI:message.voiceURI}).then(() => reply({ok:true}), error => reply({error:error.message})); return true;
  }
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!sender.tab || !message.type?.startsWith('WANDER_')) return;
  (async () => {
    const tabId = sender.tab.id;
    if (message.type === 'WANDER_SETUP') { if (!sender.tab.url.startsWith(SERVER)) await chrome.storage.session.set({ learningTab: tabId }); await chrome.tabs.create({ url: `${SERVER}/?pair=${chrome.runtime.id}` }); return { ok: true }; }
    if (message.type === 'WANDER_GUIDE_RESULT') {
      const active = await control();
      if (active?.status !== 'running' || active.tabId !== tabId || active.runId !== message.runId || active.pending?.id !== message.actionId || active.pending.frameId !== sender.frameId) return { ok: false };
      await acknowledge(active, message.ok === true); return { ok: true };
    }
    if (message.type === 'WANDER_STATUS') {
      const { token } = await chrome.storage.local.get('token');
      if (!token) return { paired: false };
      const state = await request('state');
      const active = await control();
      if (active?.tabId === tabId && (state.run?.id !== active.runId || state.run?.status !== 'running')) {
        await clearTab(tabId);
        await setControl({ ...active, status: state.run?.id === active.runId ? state.run.status : 'stopped', pending: null });
      }
      const selected = active?.tabId === tabId && active.runId === state.run?.id && (active.status === 'running' || active.page === sender.tab.url);
      return { paired: true, state: selected ? state : { ...state, run: null }, selected };
    }
    if (message.type === 'WANDER_START') {
      return startTutor(tabId, message);
    }
    if (message.type === 'WANDER_CLAIM_SPEECH') {
      const speechId = typeof message.speechId === 'string' ? message.speechId : '';
      if (!speechId || speechId.length > 1200) throw new Error('Invalid speech identifier.');
      return { claimed: await claimSpeech(speechId) };
    }
    if (message.type === 'WANDER_SPEAK') {
      const source = new URL(sender.url || sender.tab.url);
      if (['http://127.0.0.1:4318', 'http://localhost:4318'].includes(source.origin)) return { ok: false, error: 'The Wander settings page does not speak.' };
      const text = typeof message.text === 'string' ? message.text.trim() : '';
      if (!text || text.length > 1000) throw new Error('Voice text must be between 1 and 1,000 characters.');
      const { token } = await chrome.storage.local.get('token');
      if (!token) throw new Error('Connect Wander once before using the ElevenLabs voice.');
      await offscreenReady();
      const result = await chrome.runtime.sendMessage({ target: 'wander-offscreen', type: 'PLAY_SPEECH', text, token });
      if (result?.error) throw new Error(result.error);
      return { ok: true };
    }
    if (message.type === 'WANDER_CANCEL_SPEECH') {
      await cancelOffscreenSpeech();
      return { ok: true };
    }
    const active = await control();
    if (!active || active.tabId !== tabId) throw new Error('This tab has no active task.');
    if (message.type === 'WANDER_PAUSE' || message.type === 'WANDER_STOP') {
      const status = message.type === 'WANDER_STOP' ? 'stopped' : 'paused';
      await setControl({ ...active, status });
      await clearTab(tabId);
      const state = await request(status === 'stopped' ? 'stop' : 'pause', { runId: active.runId }); return { state };
    }
    if (message.type === 'WANDER_RESUME') {
      if (looping) throw new Error('The last action is finishing. Say “Hello Wander, resume” again in a moment.');
      await request('connect');
      const state = await request('resume', { runId: active.runId, answer: message.answer || '' });
      await setControl({ ...active, status: 'running', pending: null }); runLoop(); return { state };
    }
    throw new Error('Unknown extension request.');
  })().then(reply, error => reply({ error: error.message }));
  return true;
});
