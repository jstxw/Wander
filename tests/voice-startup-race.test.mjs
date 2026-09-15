import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const candidates = [process.env.TEST_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
const executablePath = candidates.find(candidate => fs.existsSync(candidate));

test('a response waits for the saved voice before choosing a TTS engine', { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<h1>Voice race fixture</h1>');
    await page.evaluate(() => {
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(options) { return attach.call(this, { ...options, mode: 'open' }); };
      window.messages = []; window.browserSpoken = [];
      window.voiceGate = new Promise(resolve => { window.resolveVoiceGate = resolve; });
      window.chrome = { storage: {
        local: {
          get: async keys => {
            if (Array.isArray(keys) && keys.includes('modelMode')) { await window.voiceGate; return { modelMode: 'dynamic', voiceURI: 'elevenlabs' }; }
            return {};
          },
          set: async () => {}
        },
        onChanged: { addListener() {} }
      }, runtime: {
        sendMessage: async message => { window.messages.push(message); if (message.type === 'WANDER_CLAIM_SPEECH') return { claimed: true }; if (message.type === 'WANDER_SPEAK') return { ok: true }; return { paired: true, selected: true, state: { budget: { spent: 0 }, run: null } }; },
        onMessage: { addListener(listener) { window.wanderMessage = listener; } }
      } };
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text; } } });
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => [], addEventListener() {}, cancel() {}, resume() {}, speak(utterance) { window.browserSpoken.push(utterance.text); } } });
    });
    await page.addScriptTag({ path: 'extension/overlay.js' });
    await page.evaluate(() => wanderMessage({ type: 'WANDER_STATE', state: { budget: { spent: 0 }, run: { id: 'race', mode: 'local', status: 'done', message: 'Only Eric should say this.' } } }));
    await page.waitForTimeout(75);
    assert.equal(await page.evaluate(() => browserSpoken.length), 0);
    assert.equal(await page.evaluate(() => messages.some(message => message.type === 'WANDER_SPEAK')), false);
    await page.evaluate(() => resolveVoiceGate());
    await page.waitForFunction(() => messages.some(message => message.type === 'WANDER_SPEAK'));
    assert.equal(await page.evaluate(() => browserSpoken.length), 0);
  } finally { await browser.close(); }
});
