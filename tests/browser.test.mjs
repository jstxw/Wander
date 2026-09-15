import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { observe, execute } from '../server/browser.mjs';
import { snapshotPage, actOnPage } from '../extension/page-tools.js';

test('browser observes a store fixture, searches, adds once and protects password/checkout', { skip: !process.env.TEST_CHROME_PATH }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.TEST_CHROME_PATH, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<label for="search">Search groceries</label><input id="search"><input type="password" value="never-expose-this"><input type="hidden" value="secret-token"><article><h2>Large eggs, 12 pack</h2><button id="add">Add to cart</button></article><button id="checkout">Checkout</button><div id="cart">Cart: 0</div><div style="display:none">Hidden secret</div><script>document.getElementById('add').onclick=()=>document.getElementById('cart').textContent='Cart: 1 — Large eggs, 12 pack';</script>`);
    let observation = await observe(page);
    assert.ok(!JSON.stringify(observation).includes('never-expose-this'));
    assert.ok(!JSON.stringify(observation).includes('secret-token'));
    assert.ok(!observation.text.includes('Hidden secret'));
    const search = observation.elements.find(e => e.label === 'Search groceries');
    await execute(page, { action: 'fill', target: search.id, value: 'eggs' }, observation);
    assert.equal(await page.locator('#search').inputValue(), 'eggs');
    observation = await observe(page);
    const add = observation.elements.find(e => e.label === 'Add to cart');
    await execute(page, { action: 'click', target: add.id, value: '' }, observation);
    assert.equal(await page.locator('#cart').innerText(), 'Cart: 1 — Large eggs, 12 pack');
    const password = observation.elements.find(e => e.type === 'password');
    await assert.rejects(execute(page, { action: 'fill', target: password.id, value: 'test' }, observation), /human input/);
    const checkout = observation.elements.find(e => e.label === 'Checkout');
    await assert.rejects(execute(page, { action: 'click', target: checkout.id, value: '' }, observation), /Checkout needs manual/);
  } finally { await browser.close(); }
});

test('current-tab action bridge handles controlled inputs and rejects checkout and stale pages', { skip: !process.env.TEST_CHROME_PATH }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.TEST_CHROME_PATH, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<label>Search<input id="query"></label><button id="add">Add to cart</button><button id="checkout">Checkout</button><p id="cart">0</p>');
    await page.evaluate(() => { document.querySelector('#query').addEventListener('input', e => document.body.dataset.query = e.target.value); document.querySelector('#add').onclick = () => document.querySelector('#cart').textContent = '1'; });
    const observation = await page.evaluate(snapshotPage);
    const search = observation.elements.find(e => e.tag === 'input');
    assert.equal((await page.evaluate(actOnPage, { action: { action: 'fill', target: search.id, value: 'eggs' }, observation })).ok, true);
    assert.equal(await page.locator('body').getAttribute('data-query'), 'eggs');
    const add = observation.elements.find(e => e.label === 'Add to cart');
    assert.equal((await page.evaluate(actOnPage, { action: { action: 'click', target: add.id }, observation })).ok, true);
    assert.equal(await page.locator('#cart').innerText(), '1');
    const checkout = observation.elements.find(e => e.label === 'Checkout');
    assert.equal((await page.evaluate(actOnPage, { action: { action: 'click', target: checkout.id }, observation })).ok, false);
    assert.equal((await page.evaluate(actOnPage, { action: { action: 'click', target: add.id }, observation: { ...observation, url: 'https://changed.metro.ca' } })).ok, false);
  } finally { await browser.close(); }
});

test('quantity controls expose current counts and update to three on a non-Metro site', { skip: !process.env.TEST_CHROME_PATH }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.TEST_CHROME_PATH, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://supplies.example/**', route => route.fulfill({ contentType: 'text/html', body: '<article><h2>Pencils</h2><label>Quantity<input type="number" min="1" max="10" value="1"></label><button>Update cart</button></article><input type="password" value="private">' }));
    await page.goto('https://supplies.example');
    let observation = await page.evaluate(snapshotPage);
    const quantity = observation.elements.find(e => e.type === 'number');
    assert.equal(quantity.value, '1');
    assert.equal(quantity.max, '10');
    assert.match(quantity.context, /Pencils/);
    assert.equal((await page.evaluate(actOnPage, { action: { action: 'fill', target: quantity.id, value: '3' }, observation })).ok, true);
    observation = await page.evaluate(snapshotPage);
    assert.equal(observation.elements.find(e => e.type === 'number').value, '3');
    assert.ok(!JSON.stringify(observation).includes('private'));
  } finally { await browser.close(); }
});

test('custom colour controls inside open shadow DOM can be observed and clicked', { skip: !process.env.TEST_CHROME_PATH }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.TEST_CHROME_PATH, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="config"></div>');
    await page.evaluate(() => {
      const root = document.querySelector('#config').attachShadow({ mode: 'open' });
      root.innerHTML = '<div role="tab" tabindex="0">Exterior Colours</div><div role="radio" tabindex="0" title="Red paint">Red</div>';
      root.querySelector('[role=radio]').onclick = () => document.body.dataset.paint = 'red';
    });
    const observation = await page.evaluate(snapshotPage);
    assert.ok(observation.elements.some(e => e.label === 'Exterior Colours'));
    const red = observation.elements.find(e => e.label === 'Red paint');
    assert.ok(red);
    assert.equal((await page.evaluate(actOnPage, { action: { action: 'click', target: red.id }, observation })).ok, true);
    assert.equal(await page.locator('body').getAttribute('data-paint'), 'red');
  } finally { await browser.close(); }
});
