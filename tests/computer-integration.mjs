// Explicitly invoked live test: two to four budgeted model calls on Steel Computer.
// The grocery page is a local fixture, not a real Metro account or cart.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { snapshotPage, actOnPage } from '../extension/page-tools.js';
const { token } = JSON.parse(fs.readFileSync('.wander/extension-pair.json', 'utf8'));
async function api(endpoint, body = {}) {
  const r = await fetch(`http://127.0.0.1:4318/api/local/${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error); return d;
}
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let runId;
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.route('https://www.metro.ca/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<h1>Grocery fixture — not a real store</h1><p>Store already selected. No login needed for this test.</p><article><h2>Selection Large Eggs, 12 pack</h2><p>$3.99 · In stock</p><button id="add">Add to cart</button></article><p id="cart">Cart: 0 items</p><button>Checkout</button><script>let count=0;document.getElementById('add').onclick=()=>document.getElementById('cart').textContent='Cart: '+(++count)+' item — Selection Large Eggs, 12 pack — quantity 1';</script>` }));
  await page.goto('https://www.metro.ca/en');
  const connected = await api('connect'); assert.equal(connected.computer.ready, true);
  const started = await api('start', { task: 'Add exactly one carton of Selection Large Eggs, 12 pack to the cart, then verify it. Do not checkout.' }); runId = started.run.id;
  let final;
  for (let step = 0; step < 4; step++) {
    const observation = await page.evaluate(snapshotPage);
    const response = await api('step', { runId, observation }); final = response.state;
    if (!response.action) break;
    const result = await page.evaluate(actOnPage, { action: response.action, observation });
    await api('result', { runId, actionId: response.action.id, ok: result.ok });
  }
  assert.equal(await page.locator('#cart').innerText(), 'Cart: 1 item — Selection Large Eggs, 12 pack — quantity 1');
  assert.equal(final.run.status, 'done');
  console.log(JSON.stringify({ result: 'Steel Computer planned and verified a current-tab cart addition on a local fixture.', steps: final.run.steps, conservativeTaskCost: final.run.spent, totalTrackedCost: final.budget.spent }));
} finally {
  if (runId) await api('stop', { runId }).catch(() => {});
  await browser.close();
}
