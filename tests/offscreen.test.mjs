import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('a superseded ElevenLabs stream cannot start a second voice', async () => {
  let listener, audioStarts = 0, cancelledBodies = 0;
  const pending = [];
  const context = {
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } },
    fetch: () => new Promise(resolve => pending.push(resolve)),
    MediaSource: class { static isTypeSupported() { return true; } },
    Audio: class { constructor() { audioStarts++; } },
    URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} },
    console
  };
  vm.runInNewContext(fs.readFileSync('extension/offscreen.js', 'utf8'), context);
  const response = () => ({ ok: true, body: { cancel: async () => { cancelledBodies++; } } });
  const first = new Promise(resolve => listener({ target: 'wander-offscreen', type: 'PLAY_SPEECH', text: 'old', token: 'token' }, {}, resolve));
  const second = new Promise(resolve => listener({ target: 'wander-offscreen', type: 'PLAY_SPEECH', text: 'new', token: 'token' }, {}, resolve));
  pending[0](response());
  assert.equal((await first).ok, true);
  assert.equal(audioStarts, 0);
  assert.equal(cancelledBodies, 1);
  listener({ target: 'wander-offscreen', type: 'CANCEL_SPEECH' }, {}, () => {});
  pending[1](response());
  assert.equal((await second).ok, true);
  assert.equal(audioStarts, 0);
  assert.equal(cancelledBodies, 2);
});
