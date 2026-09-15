import test from 'node:test';
import assert from 'node:assert/strict';

test('extension coordinates tutoring without tab actions, rejects foreign-frame acknowledgements, and verifies the next page', async () => {
  const savedFetch = globalThis.fetch, savedChrome = globalThis.chrome;
  const values = { token: 'paired' }, listeners = {}, calls = [], scripts = [], notifications = [];
  let guidanceWorks = true;
  let state = { budget: { spent: 0 }, run: { id: 'orphan', mode: 'local', tutor: true, task: 'Old task', status: 'running', message: 'Stale task' } }, steps = 0;
  const tab = { id: 7, url: 'https://catalogue.example/' };
  const storage = { get: async key => ({ [key]: values[key] }), set: async data => Object.assign(values, data), remove: async key => delete values[key] };
  globalThis.chrome = {
    storage: { local: storage, session: storage },
    runtime: { id: 'a'.repeat(32), onMessage: { addListener: fn => listeners.message = fn }, onMessageExternal: { addListener: fn => listeners.external = fn } },
    action: { onClicked: { addListener() {} } },
    tabs: { get: async () => tab, sendMessage: async (_tabId, payload) => notifications.push(payload), create: async () => {}, update: async () => { throw new Error('Tutor must never navigate the learner tab'); }, onUpdated: { addListener: fn => listeners.updated = fn }, onRemoved: { addListener() {} } },
    scripting: { executeScript: async options => {
      scripts.push(options.func?.name || 'overlay');
      if (options.func?.name === 'snapshotPage') return [{ frameId: 0, result: { url: tab.url, title: 'Catalogue', text: steps ? 'Search page opened' : 'Search the catalogue', elements: [{ id: 1, label: 'Search', tag: 'button', disabled: false }] } }];
      return [{ result: { ok: guidanceWorks } }];
    } }
  };
  globalThis.fetch = async (url, options) => {
    const endpoint = url.split('/').at(-1), body = JSON.parse(options.body); calls.push(endpoint);
    if (endpoint === 'stop') state.run.status = 'stopped';
    if (endpoint === 'pause') { state.run.status = 'paused'; state.run.message = 'You’re in control. Say “Hello Wander, resume” when you’re ready.'; }
    if (endpoint === 'start') { steps = 0; state = { ...state, run: { id: 'run', mode: 'local', tutor: true, task: body.task, status: 'running', message: 'Exploring' } }; }
    if (endpoint === 'step') {
      steps++;
      if (steps === 1) return Response.json({ state, action: { id: 'guide', action: 'click', target: 1, message: 'Click Search', value: '' } });
      state.run.status = 'done';
      return Response.json({ state, action: null });
    }
    return Response.json(state);
  };
  const message = (payload, frameId = 0) => new Promise(resolve => listeners.message(payload, { tab, frameId }, resolve));
  const until = async predicate => {
    const deadline = Date.now() + 3000;
    while (!predicate()) { if (Date.now() > deadline) throw new Error('Timed out waiting for tutor bridge'); await new Promise(r => setTimeout(r, 10)); }
  };
  try {
    await import('../extension/background.js');
    assert.equal((await message({ type: 'WANDER_CLAIM_SPEECH', speechId: 'run:Open the link.' })).claimed, true);
    assert.equal((await message({ type: 'WANDER_CLAIM_SPEECH', speechId: 'run:Open the link.' })).claimed, false);
    assert.equal((await message({ type: 'WANDER_START', task: 'Show me search' })).state.run.id, 'run');
    assert.equal(calls.filter(c => c === 'stop').length, 1);
    await until(() => scripts.includes('showGuidance'));
    assert.equal(steps, 1);
    assert.equal(calls.filter(c => c === 'result').length, 0);
    assert.equal((await message({ type: 'WANDER_GUIDE_RESULT', runId: 'run', actionId: 'guide', ok: true }, 88)).ok, false);
    assert.equal(calls.filter(c => c === 'result').length, 0);
    await new Promise(r => setTimeout(r, 20));
    await message({ type: 'WANDER_GUIDE_RESULT', runId: 'run', actionId: 'guide', ok: true });
    await until(() => values.control?.status === 'done');
    assert.equal(calls.filter(c => c === 'result').length, 1);
    assert.equal(steps, 2);
    assert.ok(!scripts.includes('actOnPage'));
    await message({ type: 'WANDER_STATUS' });
    assert.ok(scripts.includes('clearGuidance'));
    guidanceWorks = false;
    await message({ type: 'WANDER_START', task: 'Show me search again' });
    await until(() => notifications.some(item => item.error?.includes('Hello Wander, resume')));
    const failedGuidance = notifications.findLast(item => item.error?.includes('Hello Wander, resume'));
    assert.equal(failedGuidance.state.run.status, 'paused');
    assert.equal(values.control.status, 'paused');
    assert.match(failedGuidance.error, /Say “Hello Wander, resume”/);
  } finally { globalThis.fetch = savedFetch; globalThis.chrome = savedChrome; }
});
