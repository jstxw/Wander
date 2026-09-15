import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { snapshotPage } from '../extension/page-tools.js';
import { showGuidance, clearGuidance } from '../extension/guidance.js';
import { SteelComputer } from '../server/computer.mjs';

const executablePath = process.env.TEST_CHROME_PATH;
async function fixture(t) {
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<style>body{padding:60px;font-family:Arial}button,input,select{padding:14px;margin:10px}</style><h1>Find a community workshop</h1><label>Search workshops<input id="query"></label><label>Colour<select id="colour"><option value="">Any</option><option value="blue">Blue</option></select></label><label>Email<input id="email" type="email"></label><button id="search">Search</button><button id="wrong">About us</button><button id="checkout">Checkout</button><input type="password" value="secret"><p id="result">Choose an action</p>');
  await page.evaluate(() => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(o) { return attach.call(this, { ...o, mode: 'open' }); };
    window.messages = []; window.chrome = { runtime: { sendMessage: async m => { window.messages.push(m); } } };
    document.querySelector('#search').onclick = () => document.querySelector('#result').textContent = 'Workshops found';
  });
  return page;
}

test('tutor highlights without clicking; only learner interaction advances; guide text stays out of snapshots', { skip: !executablePath }, async t => {
  const page = await fixture(t);
  const observation = await page.evaluate(snapshotPage);
  const target = observation.elements.find(e => e.label === 'Search').id;
  const action = { id: 'action-one', action: 'click', target, value: '', message: 'Click Search to find upcoming workshops.' };
  assert.equal((await page.evaluate(showGuidance, { action, observation, runId: 'mission' })).ok, true);
  assert.equal(await page.locator('#result').textContent(), 'Choose an action');
  assert.equal(await page.evaluate(() => messages.length), 0);
  assert.ok(!(await page.evaluate(snapshotPage)).text.includes('Click Search to find'));
  assert.equal(await page.evaluate(() => {
    const root = document.querySelector('#wander-guidance').shadowRoot;
    const veils = [...root.querySelectorAll('.veil')];
    const target = document.querySelector('#search').getBoundingClientRect();
    const clearPoint = document.elementFromPoint(target.left + target.width / 2, target.top + target.height / 2);
    return veils.length === 4 && veils.every(veil => !veil.hidden && getComputedStyle(veil).pointerEvents === 'none') && clearPoint === document.querySelector('#search');
  }), true);
  fs.mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/wander-guidance.png' });
  await page.locator('#search').click();
  await page.waitForFunction(() => messages.length === 1);
  assert.equal(await page.locator('#result').textContent(), 'Workshops found');
  assert.deepEqual(await page.evaluate(() => messages[0]), { type: 'WANDER_GUIDE_RESULT', runId: 'mission', actionId: 'action-one', ok: true });
  assert.equal(await page.locator('#wander-guidance').count(), 0);
});

test('wrong clicks trigger reobservation; clearing a highlight cancels callbacks', { skip: !executablePath }, async t => {
  const page = await fixture(t);
  const observation = await page.evaluate(snapshotPage);
  const action = { id: 'a', action: 'click', target: observation.elements.find(e => e.label === 'Search').id, message: 'Click Search' };
  await page.evaluate(showGuidance, { action, observation, runId: 'm' });
  await page.locator('#wrong').click();
  await page.waitForFunction(() => messages.length === 1);
  assert.equal(await page.evaluate(() => messages[0].ok), false);
  await page.evaluate(showGuidance, { action, observation, runId: 'm' });
  await page.evaluate(clearGuidance);
  await page.locator('#search').click();
  await page.waitForTimeout(850);
  assert.equal(await page.evaluate(() => messages.length), 1);
});

test('fill guidance waits for consent, can fill ordinary fields, and refuses sensitive targets', { skip: !executablePath }, async t => {
  const page = await fixture(t);
  const observation = await page.evaluate(snapshotPage);
  const target = observation.elements.find(e => e.tag === 'input' && !e.sensitive).id;
  await page.evaluate(showGuidance, { action: { id: 'fill', action: 'fill', target, value: 'art', message: 'Type art, then leave the field.' }, observation, runId: 'm' });
  assert.equal(await page.locator('#query').inputValue(), '');
  assert.equal(await page.locator('#wander-guidance .autofill').textContent(), 'Fill it for me');
  await page.locator('#wander-guidance .autofill').click();
  await page.waitForFunction(() => messages.length === 1);
  assert.equal(await page.locator('#query').inputValue(), 'art');
  assert.equal(await page.evaluate(() => messages[0].ok), true);
  await page.evaluate(() => { messages = []; });
  const selectTarget = observation.elements.find(e => e.tag === 'select').id;
  await page.evaluate(showGuidance, { action: { id: 'select', action: 'select', target: selectTarget, value: 'blue', message: 'Choose blue.' }, observation, runId: 'm' });
  assert.equal(await page.locator('#wander-guidance .autofill').textContent(), 'Choose it for me');
  await page.locator('#wander-guidance .autofill').click();
  await page.waitForFunction(() => messages.length === 1);
  assert.equal(await page.locator('#colour').inputValue(), 'blue');
  const emailTarget = observation.elements.find(e => e.type === 'email');
  assert.equal(emailTarget.autofillable, false);
  await page.evaluate(showGuidance, { action: { id: 'email', action: 'fill', target: emailTarget.id, value: 'person@example.com', message: 'Enter your email.' }, observation, runId: 'm' });
  assert.equal(await page.locator('#wander-guidance .autofill').isHidden(), true);
  assert.equal(await page.locator('#email').inputValue(), '');
  for (const e of observation.elements.filter(e => e.sensitive || e.label === 'Checkout')) {
    assert.equal((await page.evaluate(showGuidance, { action: { id: 'bad', action: 'click', target: e.id }, observation, runId: 'm' })).ok, false);
  }
});

test('Steel tutor executes a remote runtime, propagates usage and does not retry paid errors', async () => {
  const c = new SteelComputer({ key: 'steel-test', stateFile: '/unused' }); c.computer = { id: 'fixture' };
  let calls = 0;
  c.exec = async body => { calls++; assert.equal(body.argv[0], '/tmp/wander-agent/venv/bin/python'); assert.equal(body.argv[2], 'plan'); assert.equal(body.env.STEEL_API_KEY, 'steel-test'); return { exitCode: 0, output: JSON.stringify({ status: 200, data: { usage: { prompt_tokens: 10 }, wanderWorkspace: { rehearsed: true } } }) }; };
  const response = await c.tutorFetcher('openai-test', 'm')('', { body: '{}' });
  assert.equal((await response.json()).wanderWorkspace.rehearsed, true); assert.equal(calls, 1);
  c.exec = async () => { calls++; throw new Error('gateway'); };
  await assert.rejects(c.tutorFetcher('key', 'm')('', { body: '{}' }), /gateway/);
  assert.equal(calls, 2);
});

test('tutor workspace keeps the original theme and renders real evidence metadata on desktop and mobile', { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('https://wander.test/**', route => {
    const name = new URL(route.request().url()).pathname;
    if (name === '/api/state') return route.fulfill({ json: { configured: true, keys: { openai: true, steel: true }, budget: { spent: .004 }, computer: { ready: true }, practice: { phase: 'observed', decisions: 2, artifacts: ['state.json', 'observation.json', 'guidance.json'], hasEvidence: false }, run: { id: 'm', tutor: true, mode: 'local', status: 'running', phase: 'your-turn', message: 'Click Search to find workshops.', steps: 2 }, logs: [{ id: 'one', kind: 'info', message: 'Public page inspected on Steel Computer.' }] } });
    const file = name === '/' ? 'index.html' : name.slice(1);
    if (!['index.html', 'app.js', 'style.css', 'tutor.css', 'favicon.svg'].includes(file)) return route.abort();
    return route.fulfill({ body: fs.readFileSync(path.join('public', file)), contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html' });
  });
  await page.goto('https://wander.test/');
  await page.waitForFunction(() => document.getElementById('workspaceFiles').textContent.includes('guidance.json'));
  assert.equal(await page.locator('#orbTitle').textContent(), 'You’ve got this.');
  fs.mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/wander-tutor-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'artifacts/wander-tutor-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
});
