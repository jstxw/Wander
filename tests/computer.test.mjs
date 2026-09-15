import test from 'node:test';
import assert from 'node:assert/strict';
import { SteelComputer } from '../server/computer.mjs';

test('wake gateway failure reconciles running computer without creating a duplicate', async () => {
  const c = new SteelComputer({ key: 'test', stateFile: '/tmp/wander-nonexistent-test-state' });
  c.computer = { id: 'fixture' };
  let checks = 0, resumes = 0, executions = 0;
  c.api = async (path, method) => {
    if (path.endsWith('/resume')) { resumes++; throw Object.assign(new Error('gateway'), { status: 502 }); }
    if (path.endsWith('/exec')) { executions++; return { exitCode: 0, output: '/usr/bin/python3' }; }
    assert.equal(method, undefined);
    return { id: 'fixture', status: ++checks === 1 ? 'paused' : 'running' };
  };
  assert.equal((await c.ensure()).ready, true);
  assert.equal(resumes, 1);
  assert.equal(executions, 2);
});

test('paid model execution is never retried on a gateway error', async () => {
  const c = new SteelComputer({ key: 'test', stateFile: '/tmp/wander-nonexistent-test-state' });
  c.ready = true;
  let attempts = 0;
  c.exec = async () => { attempts++; throw Object.assign(new Error('gateway'), { status: 502 }); };
  await assert.rejects(c.fetcher('test', 'fixture')('', { body: '{}' }), /gateway/);
  assert.equal(attempts, 1);
});

test('deleted saved computer is replaced exactly once', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-deleted-'));
  try {
    const stateFile = path.join(dir, 'computer.json');
    fs.writeFileSync(stateFile, JSON.stringify({ id: 'deleted' }));
    const c = new SteelComputer({ key: 'test', stateFile });
    let creates = 0;
    c.api = async (endpoint, method, body) => {
      if (endpoint === '/computers/deleted') throw Object.assign(new Error('deleted'), { status: 404 });
      if (endpoint === '/computers') { creates++; assert.equal(body.idleTimeoutSeconds, 900); return { id: 'new', status: 'running' }; }
      if (endpoint.endsWith('/exec')) return { exitCode: 0, output: '/usr/bin/python3' };
      return { id: 'new', status: 'running' };
    };
    assert.equal((await c.ensure()).ready, true);
    assert.equal(creates, 1);
    assert.equal(JSON.parse(fs.readFileSync(stateFile)).id, 'new');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('failed wake never issues conflicting stop requests', async () => {
  const c = new SteelComputer({ key: 'test', stateFile: '/tmp/unused-wander-state' });
  c.computer = { id: 'same' };
  c.prepare = async () => { throw new Error('wake failed'); };
  c.api = async (endpoint, method = 'GET') => { assert.equal(method, 'GET'); return { id: 'same', status: 'paused' }; };
  await assert.rejects(c.ensure(), /wake failed/);
});
