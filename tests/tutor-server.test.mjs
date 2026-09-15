import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('actual coordinator serves tutor assets and rejects autonomous/unauthenticated commands', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-server-'));
  const port = 46000 + Math.floor(Math.random() * 8000);
  const child = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(port), WANDER_DATA_DIR: directory, OPENAI_API_KEY: '', STEEL_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null) { const ended = new Promise(resolve => child.once('exit', resolve)); child.kill(); await ended; }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start')), 8000);
    child.stdout.on('data', chunk => { if (chunk.toString().includes('Wander is ready')) { clearTimeout(timer); resolve(); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}`)); });
  });
  const origin = `http://127.0.0.1:${port}`;
  const html = await (await fetch(origin)).text();
  assert.match(html, /INSIDE WANDER’S COMPUTER/);
  assert.match(await (await fetch(origin + '/tutor.css')).text(), /tutor-workspace/);
  const state = await (await fetch(origin + '/api/state')).json();
  assert.equal(state.practice, null);
  assert.equal(state.run, null);
  const headers = { 'Content-Type': 'application/json', 'X-Wander-Request': '1' };
  const removed = await fetch(origin + '/api/run', { method: 'POST', headers, body: JSON.stringify({ task: 'click something' }) });
  assert.equal(removed.status, 400);
  assert.match((await removed.json()).error, /extension/);
  const unpaired = await fetch(origin + '/api/local/start', { method: 'POST', headers, body: '{}' });
  assert.equal(unpaired.status, 403);
  const external = await fetch(origin + '/api/state', { headers: { Origin: 'https://untrusted.example' } });
  assert.equal(external.status, 403);
});
