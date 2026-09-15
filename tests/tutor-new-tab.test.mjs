import test from 'node:test';
import assert from 'node:assert/strict';

test('a link that opens a new tab carries the running task and guidance to that tab', async () => {
  const savedFetch = globalThis.fetch, savedChrome = globalThis.chrome;
  const values = { token: 'paired' }, listeners = {}, calls = [], scripts = [];
  const tabs = { 7: { id: 7, url: 'https://catalogue.example/' }, 9: { id: 9, url: 'about:blank' } };
  let state = { budget: { spent: 0 }, run: null }, steps = 0;
  const storage = { get: async key => ({ [key]: values[key] }), set: async data => Object.assign(values, data), remove: async key => delete values[key] };
  globalThis.chrome = {
    storage: { local: storage, session: storage },
    runtime: { id: 'a'.repeat(32), onMessage: { addListener: fn => listeners.message = fn }, onMessageExternal: { addListener() {} } },
    action: { onClicked: { addListener() {} } },
    tabs: { get: async id => tabs[id], sendMessage: async () => {}, create: async () => {},
      onCreated: { addListener: fn => listeners.created = fn }, onUpdated: { addListener: fn => listeners.updated = fn }, onRemoved: { addListener() {} } },
    scripting: { executeScript: async options => {
      scripts.push({ name: options.func?.name || 'overlay', tabId: options.target.tabId, url: tabs[options.target.tabId]?.url });
      if (options.func?.name === 'snapshotPage') {
        const current = tabs[options.target.tabId];
        return [{ frameId: 0, result: { url: current.url, title: 'Catalogue', text: 'Results', elements: [{ id: 1, label: 'Open result', tag: 'a', disabled: false }] } }];
      }
      return [{ result: { ok: true } }];
    } }
  };
  globalThis.fetch = async (url, options) => {
    const endpoint = url.split('/').at(-1), body = JSON.parse(options.body); calls.push(endpoint);
    if (endpoint === 'start') state = { ...state, run: { id: 'run', mode: 'local', tutor: true, task: body.task, status: 'running', message: 'Exploring' } };
    if (endpoint === 'step') {
      steps++;
      if (steps === 1) return Response.json({ state, action: { id: 'guide', action: 'click', target: 1, message: 'Open the result', value: '' } });
      state.run.status = 'done';
      return Response.json({ state, action: null });
    }
    return Response.json(state);
  };
  const messageFrom = (tab, payload) => new Promise(resolve => listeners.message(payload, { tab, frameId: 0 }, resolve));
  const until = async predicate => {
    const deadline = Date.now() + 3000;
    while (!predicate()) { if (Date.now() > deadline) throw new Error('Timed out waiting for the new tab handoff'); await new Promise(r => setTimeout(r, 10)); }
  };
  try {
    await import('../extension/background.js');
    await messageFrom(tabs[7], { type: 'WANDER_START', task: 'Open a result' });
    await until(() => scripts.some(s => s.name === 'showGuidance' && s.tabId === 7));

    // The learner clicks a target="_blank" link: Chrome opens tab 9 from tab 7, first blank, then the real page.
    assert.equal(typeof listeners.created, 'function', 'background listens for new tabs');
    await listeners.created({ ...tabs[9], openerTabId: 7, pendingUrl: 'https://catalogue.example/result' });
    await listeners.updated(9, { status: 'complete' }, tabs[9]);
    tabs[9].url = 'https://catalogue.example/result';
    await listeners.updated(9, { status: 'complete' }, tabs[9]);

    await until(() => steps === 2);
    assert.equal(values.control.tabId, 9);
    assert.ok(scripts.some(s => s.name === 'clearGuidance' && s.tabId === 7), 'old tab guidance is cleared');
    assert.ok(scripts.some(s => s.name === 'snapshotPage' && s.tabId === 9), 'the new tab is observed');
    assert.ok(!scripts.some(s => s.name === 'snapshotPage' && s.url === 'about:blank'), 'blank pages are not observed');
    assert.equal(calls.filter(c => c === 'result').length, 1, 'the click that opened the tab is acknowledged once');

    const status = await messageFrom(tabs[9], { type: 'WANDER_STATUS' });
    assert.equal(status.selected, true, 'the new tab shows the task instead of resetting');
    const late = await messageFrom(tabs[7], { type: 'WANDER_GUIDE_RESULT', runId: 'run', actionId: 'guide', ok: true });
    assert.equal(late.ok, false);
    assert.equal(calls.filter(c => c === 'result').length, 1, 'a late acknowledgement from the old tab is ignored');
  } finally { globalThis.fetch = savedFetch; globalThis.chrome = savedChrome; }
});
