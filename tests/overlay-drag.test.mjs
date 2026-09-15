import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const executablePath = process.env.TEST_CHROME_PATH;
const VIEWPORT = { width: 1400, height: 900 };
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) <= 2, `${message}: expected ≈${expected}, got ${actual}`);

async function fixture(t, saved = {}) {
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: VIEWPORT });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<h1>Community library</h1><p>A plain page for the floating Wander widget.</p>');
  await page.evaluate(values => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) { return attach.call(this, { ...options, mode: 'open' }); };
    window.stored = { ...values };
    window.chrome = {
      storage: {
        local: {
          get: async keys => { const list = Array.isArray(keys) ? keys : [keys]; return Object.fromEntries(list.filter(key => key in stored).map(key => [key, stored[key]])); },
          set: async data => { Object.assign(stored, data); }
        },
        onChanged: { addListener() {} }
      },
      runtime: { sendMessage: async () => ({ paired: true, selected: true, state: { budget: { spent: 0 }, run: null } }), onMessage: { addListener() {} } }
    };
  }, saved);
  await page.addScriptTag({ path: 'extension/overlay.js' });
  await page.waitForTimeout(150);
  const box = selector => page.locator(`#wander-widget ${selector}`).boundingBox();
  const cardHidden = () => page.evaluate(() => document.querySelector('#wander-widget').shadowRoot.getElementById('card').hidden);
  const dragBy = async (selector, dx, dy) => {
    const from = await box(selector), x = from.x + from.width / 2, y = from.y + from.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
    await page.mouse.move(x + dx, y + dy, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(50);
  };
  return { page, errors, box, cardHidden, dragBy };
}

test('the widget starts at the right middle and a plain click still opens the panel', { skip: !executablePath }, async t => {
  const { page, errors, box, cardHidden } = await fixture(t);
  const orb = await box('#orb');
  assert.ok(orb.x > 1250, `button starts on the right, got x=${orb.x}`);
  near(orb.y + orb.height / 2, VIEWPORT.height / 2, 'button starts vertically centred');
  await page.locator('#wander-widget #orb').click();
  assert.equal(await cardHidden(), false);
  assert.equal(await page.evaluate(() => 'widgetPosition' in stored), false, 'a click does not save a position');
  assert.deepEqual(errors, []);
});

test('dragging the button moves the widget without toggling the panel and saves the position', { skip: !executablePath }, async t => {
  const { page, errors, box, cardHidden, dragBy } = await fixture(t);
  const before = await box('#orb');
  await dragBy('#orb', -600, -250);
  const after = await box('#orb');
  near(after.x, before.x - 600, 'moved left');
  near(after.y, before.y - 250, 'moved up');
  assert.equal(await cardHidden(), true, 'dragging is not a click');
  const saved = await page.evaluate(() => stored.widgetPosition);
  assert.ok(Number.isFinite(saved?.left) && Number.isFinite(saved?.top), 'position saved');
  await page.locator('#wander-widget #orb').click();
  assert.equal(await cardHidden(), false, 'the next plain click still opens the panel');
  assert.deepEqual(errors, []);
});

test('dragging the title row moves the open panel, keeps text unselected, and its buttons still work', { skip: !executablePath }, async t => {
  const { page, errors, box, cardHidden, dragBy } = await fixture(t, { panelOpen: true });
  assert.equal(await cardHidden(), false);
  const before = await box('.head');
  await dragBy('.brand', -500, 0);
  near((await box('.head')).x, before.x - 500, 'panel moved left with the title row');
  assert.equal(await page.evaluate(() => getSelection().toString()), '', 'dragging does not select text');
  await page.locator('#wander-widget #minimize').click();
  assert.equal(await cardHidden(), true, 'the minimize button still works');
  assert.deepEqual(errors, []);
});

test('a saved position is restored, and an off-screen one is pulled back into view', { skip: !executablePath }, async t => {
  const restored = await fixture(t, { widgetPosition: { left: 200, top: 150 } });
  near((await restored.box('.wrap')).x, 200, 'restored left');
  near((await restored.box('#orb')).y, 150, 'restored top');

  const offscreen = await fixture(t, { widgetPosition: { left: 5000, top: -300 } });
  const orb = await offscreen.box('#orb');
  assert.ok(orb.x >= 0 && orb.x + orb.width <= VIEWPORT.width, `button inside horizontally, got x=${orb.x}`);
  assert.ok(orb.y >= 0 && orb.y + orb.height <= VIEWPORT.height, `button inside vertically, got y=${orb.y}`);
  await offscreen.dragBy('#orb', -3000, 2000);
  const dragged = await offscreen.box('#orb');
  assert.ok(dragged.x >= 0 && dragged.y + dragged.height <= VIEWPORT.height, 'a drag cannot push it off screen');
});

test('opening the panel near an edge keeps it on screen, and closing it returns the button to its spot', { skip: !executablePath }, async t => {
  const { page, errors, box, cardHidden } = await fixture(t, { widgetPosition: { left: -250, top: 700 } });
  const spot = await box('#orb');
  assert.ok(spot.x >= 0 && spot.y + spot.height <= VIEWPORT.height, 'the collapsed button is visible');
  await page.locator('#wander-widget #orb').click();
  assert.equal(await cardHidden(), false);
  const open = await box('.wrap');
  assert.ok(open.x >= 0 && open.x + open.width <= VIEWPORT.width, `open panel inside horizontally, got x=${open.x}`);
  assert.ok(open.y >= 0 && open.y + open.height <= VIEWPORT.height, `open panel inside vertically, got y=${open.y} h=${open.height}`);
  await page.locator('#wander-widget #minimize').click();
  const closed = await box('#orb');
  near(closed.x, spot.x, 'button back to its x');
  near(closed.y, spot.y, 'button back to its y');
  assert.deepEqual(errors, []);
});
