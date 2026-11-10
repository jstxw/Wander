import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Budget } from '../server/budget.mjs';
import { planDesktop, validateDesktopObservation } from '../server/desktop-planner.mjs';
import { demoTarget, listViewEvidence } from '../desktop/tutor.mjs';

const finderIcons = {
  snapshotId: 's3', app: { name: 'Finder', bundleId: 'com.apple.finder', pid: 412 }, window: { title: 'Documents' },
  layout: ['AXToolbar', 'AXOutline'], containerCounts: { AXOutline: 1, AXToolbar: 1 }, texts: ['Documents'], truncated: false,
  controls: [
    { id: 'c1', role: 'AXRadioButton', label: 'Icon', area: 'window', value: true },
    { id: 'c2', role: 'AXRadioButton', label: 'List', area: 'window', value: false },
    { id: 'c3', role: 'AXTextField', subrole: 'AXSearchField', label: 'Search', area: 'window', filled: false },
    { id: 'c4', role: 'AXMenuBarItem', label: 'View', area: 'menubar' }
  ]
};

test('desktop observations keep only known fields and never carry secure values', () => {
  const observation = validateDesktopObservation({
    ...finderIcons, extra: 'drop me',
    controls: [...finderIcons.controls, { id: 'c5', role: 'AXTextField', subrole: 'AXSecureTextField', label: 'Password', area: 'window', value: 'hunter2', filled: true, frame: [1, 2, 3, 4] }]
  });
  assert.equal(observation.extra, undefined);
  const secure = observation.controls.find(control => control.id === 'c5');
  assert.equal(secure.value, undefined); assert.equal(secure.filled, undefined); assert.equal(secure.frame, undefined);
  assert.equal(observation.controls.find(control => control.id === 'c4').area, 'menubar');
  assert.throws(() => validateDesktopObservation({ ...finderIcons, snapshotId: '../etc' }), /Invalid app observation/);
  assert.throws(() => validateDesktopObservation({ ...finderIcons, controls: [{ id: 'x', role: 'AXButton' }] }), /Invalid app observation/);
  assert.throws(() => validateDesktopObservation({ ...finderIcons, controls: Array.from({ length: 161 }, (_, i) => ({ id: `c${i}`, role: 'AXButton' })) }), /Invalid app observation/);
});

test('desktop planner sends the window without the snapshot id and returns one step', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-desktop-'));
  try {
    const budget = new Budget(path.join(directory, 'budget.json'));
    const run = { spent: 0, steps: 0, modelMode: 'dynamic' };
    let sent;
    const reply = content => async (_, options) => { sent = JSON.parse(options.body); return Response.json({ usage: { prompt_tokens: 50, completion_tokens: 10 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] }); };
    const observation = validateDesktopObservation(finderIcons);
    const action = await planDesktop({ key: 'k', task: 'Show files as a list', observation, history: [], budget, run, signal: new AbortController().signal,
      fetcher: reply({ action: 'point', target: 'c2', value: '', message: 'Click List to show files as rows.' }) });
    assert.equal(action.action, 'point'); assert.equal(action.target, 'c2');
    assert.match(action.message, /^First, click List/);
    const user = JSON.parse(sent.messages[1].content);
    assert.equal(user.WINDOW.snapshotId, undefined);
    assert.equal(user.WINDOW.app.name, 'Finder');
    assert.match(sent.messages[0].content, /Mac app/);
    assert.equal(sent.response_format.json_schema.name, 'desktop_step');

    const done = await planDesktop({ key: 'k', task: 'x', observation, history: [], budget, run, signal: new AbortController().signal,
      fetcher: reply({ action: 'done', target: 'c2', value: '', message: 'Finder now shows a list.' }) });
    assert.equal(done.target, '');
    await assert.rejects(planDesktop({ key: 'k', task: 'x', observation, history: [], budget, run, signal: new AbortController().signal,
      fetcher: reply({ action: 'click', target: 'c2', value: '', message: 'Click.' }) }), /Unexpected model action/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('Finder demo targets the List control, then the View menu, and verifies List view', () => {
  assert.equal(demoTarget(finderIcons).control.id, 'c2');
  const compact = { ...finderIcons, controls: finderIcons.controls.filter(control => control.role !== 'AXRadioButton') };
  assert.equal(demoTarget(compact).control.id, 'c4');
  const menuOpen = { ...compact, controls: [...compact.controls, { id: 'c9', role: 'AXMenuItem', label: 'as List', area: 'menubar' }] };
  assert.equal(demoTarget(menuOpen).control.id, 'c9');
  assert.equal(listViewEvidence(finderIcons, { outlines: 1 }), false);
  const selected = { ...finderIcons, controls: finderIcons.controls.map(control => control.id === 'c2' ? { ...control, value: true } : control) };
  assert.equal(listViewEvidence(selected), true);
  assert.equal(listViewEvidence({ ...compact, containerCounts: { AXOutline: 2 } }, { outlines: 1 }), true);
});

test('desktop endpoint accepts only the per-launch token and shares the single lesson', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-desktop-server-'));
  const port = 46000 + Math.floor(Math.random() * 8000);
  const token = randomBytes(32).toString('hex');
  const child = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(port), WANDER_DATA_DIR: directory,
    WANDER_ENV_FILE: path.join(directory, '.env.local'), WANDER_DESKTOP_TOKEN: token, OPENAI_API_KEY: 'sk-test-only', STEEL_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null) { const ended = new Promise(resolve => child.once('exit', resolve)); child.kill(); await ended; }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start')), 8000);
    child.stdout.on('data', chunk => { if (chunk.toString().includes('Wander is ready')) { clearTimeout(timer); resolve(); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}`)); });
  });
  const url = endpoint => `http://127.0.0.1:${port}/api/desktop/${endpoint}`;
  const post = (endpoint, body, headers = {}) => fetch(url(endpoint), { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const auth = { Authorization: `Bearer ${token}` };

  assert.equal((await post('start', { task: 'x' })).status, 403);
  assert.equal((await post('start', { task: 'x' }, { Authorization: `Bearer ${'0'.repeat(64)}` })).status, 403);
  assert.equal((await post('start', { task: 'x' }, { ...auth, Origin: `http://127.0.0.1:${port}` })).status, 403);

  const started = await (await post('start', { task: 'Show files as a list', app: 'Finder' }, auth)).json();
  assert.equal(started.run.mode, 'desktop'); assert.equal(started.run.status, 'running');
  const second = await post('start', { task: 'Another' }, auth);
  assert.equal(second.status, 400); assert.match((await second.json()).error, /Another Wander lesson/);
  const invalid = await post('step', { runId: started.run.id, observation: { snapshotId: 'nope', controls: [] } }, auth);
  assert.equal(invalid.status, 400); assert.match((await invalid.json()).error, /Invalid app observation/);
  const stopped = await (await post('stop', { runId: started.run.id }, auth)).json();
  assert.equal(stopped.run.status, 'stopped');
});
