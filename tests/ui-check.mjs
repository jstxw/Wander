import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  // Use a clean UI-only state: never capture credentials or a real shopping session.
  await page.route('**/api/state', route => route.fulfill({ json: { configured: false, keys: { openai: false, steel: false }, budget: { spent: 0, limit: 1.8, calls: 0, runLimit: .08, model: 'gpt-5.6-luna' }, session: null, connecting: false, run: null, logs: [] } }));
  await page.goto('http://127.0.0.1:4318/');
  await page.getByRole('button', { name: 'Set up Wander' }).waitFor();
  assert.equal(await page.locator('#orb').count(), 1);
  await page.getByRole('button', { name: '“Go to Metro and add eggs to my cart”' }).click();
  assert.match(await page.locator('#command').inputValue(), /cart/);
  await page.locator('#command').fill('');
  fs.mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/wander-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Set up Wander' }).click();
  assert.equal(await page.locator('#settings').evaluate(el => el.open), true);
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'artifacts/wander-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Desktop/mobile layout, orb, example command, settings, and browser console checks passed.');
} finally { await browser.close(); }
