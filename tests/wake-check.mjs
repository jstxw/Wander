import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const candidates = [process.env.TEST_CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
const executablePath = candidates.find(candidate => fs.existsSync(candidate));
if (!executablePath) throw new Error('Set TEST_CHROME_PATH to a Google Chrome executable.');
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<h1>Wake test</h1>');
  await page.evaluate(() => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) { return attach.call(this, { ...options, mode: 'open' }); };
    window.messages = []; window.recognizers = []; window.spoken = []; window.store = {}; window.fetchCalls = 0;
    window.fetch = () => { window.fetchCalls++; throw new Error('The website context must not fetch Wander services.'); };
    window.chrome = { storage: { onChanged: { addListener(listener) { window.storageChanged = listener; } }, local: {
      get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in window.store).map(key => [key, window.store[key]])),
      set: async values => Object.assign(window.store, values)
    } }, runtime: {
      sendMessage: async message => { window.messages.push(message); if (message.type === 'WANDER_CLAIM_SPEECH') return { claimed: true }; if (['WANDER_SPEAK', 'WANDER_CANCEL_SPEECH'].includes(message.type)) return { ok: true }; return { paired: true, selected: true, state: { budget: { spent: 0 }, run: null } }; },
      onMessage: { addListener(listener) { window.wanderMessage = listener; } }
    } };
    window.SpeechRecognition = window.webkitSpeechRecognition = class {
      constructor() { window.lastRecognition = this; window.recognizers.push(this); }
      start() {}
      abort() { this.onend?.(); }
    };
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text; } } });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [], addEventListener() {}, cancel() {}, resume() {},
      speak(utterance) { window.spoken.push(utterance.text); setTimeout(() => { utterance.onstart?.(); utterance.onend?.(); }, 0); }
    } });
  });
  await page.addScriptTag({ path: 'extension/overlay.js' });
  const cardHidden = () => page.evaluate(() => document.querySelector('#wander-widget').shadowRoot.getElementById('card').hidden);
  assert.equal(await cardHidden(), true);
  await page.evaluate(() => document.querySelector('#wander-widget').shadowRoot.getElementById('wake').click());
  await page.waitForFunction(() => Boolean(window.lastRecognition));
  const say = text => page.evaluate(text => {
    const result = [{ transcript: text }]; result.isFinal = true;
    window.lastRecognition.onresult({ resultIndex: 0, results: [result] });
  }, text);
  await say('ordinary background conversation');
  assert.equal(await page.evaluate(() => messages.filter(m => m.type === 'WANDER_START').length), 0);
  await say('Hello Wander find notebooks');
  await page.waitForFunction(() => messages.some(m => m.type === 'WANDER_START'));
  assert.equal(await page.evaluate(() => messages.find(m => m.type === 'WANDER_START').task), 'find notebooks');
  assert.equal(await cardHidden(), true);
  await page.waitForFunction(() => window.recognizers.length >= 2);
  await say('Hello');
  await say('Wander');
  await page.waitForFunction(() => window.recognizers.length >= 3);
  assert.equal(await page.evaluate(() => document.querySelector('#wander-widget').shadowRoot.getElementById('orb').classList.contains('listening')), true);
  await say('hello');
  await page.waitForFunction(() => window.recognizers.length >= 4);
  assert.equal(await page.evaluate(() => messages.filter(m => m.type === 'WANDER_START').length), 1);
  assert.equal(await page.evaluate(() => document.querySelector('#wander-widget').shadowRoot.getElementById('orb').classList.contains('listening')), true);
  await page.evaluate(() => { lastRecognition.onerror({ error: 'no-speech' }); lastRecognition.onend(); });
  await page.waitForFunction(() => window.recognizers.length >= 5);
  await say('find pencils');
  await page.waitForFunction(() => messages.filter(m => m.type === 'WANDER_START').length === 2);
  assert.deepEqual(await page.evaluate(() => messages.filter(m => m.type === 'WANDER_START').map(m => m.task)), ['find notebooks', 'find pencils']);
  assert.equal(await cardHidden(), true);
  await page.evaluate(() => wanderMessage({ type: 'WANDER_STATE', state: { budget: { spent: 0 }, run: { id: 'running-test', mode: 'local', status: 'running', phase: 'exploring', message: 'Check the website.', steps: 1, maxSteps: 60 } } }));
  await page.waitForFunction(() => window.spoken.includes('Check the website.'));
  assert.equal(await cardHidden(), true);
  await page.evaluate(() => wanderMessage({ type: 'WANDER_STATE', state: { budget: { spent: 0 }, run: { id: 'url-test', mode: 'local', status: 'done', message: 'I opened https://example.com/a/very/long/path?with=query for you.', steps: 1, maxSteps: 60 } } }));
  await page.waitForFunction(() => window.spoken.some(text => text.includes('the website')));
  assert.equal(await page.evaluate(() => spoken.some(text => /https?:\/\//i.test(text))), false);
  const before = await page.evaluate(() => spoken.length);
  await page.evaluate(() => wanderMessage({ type: 'WANDER_STATE', state: { budget: { spent: 0 }, run: { id: 'url-test', mode: 'local', status: 'done', message: 'I opened https://example.com/a/very/long/path?with=query for you.' } } }));
  assert.equal(await page.evaluate(() => spoken.length), before);
  await page.evaluate(() => {
    document.querySelector('#wander-widget').shadowRoot.getElementById('wake').click();
    wanderMessage({ type: 'WANDER_STATE', state: { budget: { spent: 0 }, run: { id: 'question', mode: 'local', status: 'waiting', message: 'Which color?' } } });
  });
  await page.waitForFunction(() => lastRecognition.lang === 'en-CA');
  await say('blue');
  await page.evaluate(() => lastRecognition.onend());
  await page.waitForFunction(() => messages.some(m => m.type === 'WANDER_RESUME' && m.answer === 'blue'));
  const recognizersBeforeResume = await page.evaluate(() => window.recognizers.length);
  await page.evaluate(() => {
    document.querySelector('#wander-widget').shadowRoot.getElementById('wake').click();
    wanderMessage({ type: 'WANDER_STATE', state: { budget: { spent: 0 }, run: { id: 'paused-task', mode: 'local', status: 'paused', message: 'Say “Hello Wander, resume” to take another look.' } } });
  });
  await page.waitForFunction(count => window.recognizers.length > count, recognizersBeforeResume);
  await say('Hello Wander resume');
  await page.waitForFunction(() => messages.some(m => m.type === 'WANDER_RESUME' && m.answer === ''));
  await page.evaluate(() => {
    storageChanged({ voiceURI: { newValue: 'elevenlabs' } }, 'local');
    wanderMessage({ type: 'WANDER_STATE', state: { budget: { spent: 0 }, run: { id: 'elevenlabs-test', mode: 'local', status: 'done', message: 'Your ElevenLabs response is ready.' } } });
  });
  await page.waitForFunction(() => messages.some(message => message.type === 'WANDER_SPEAK'));
  assert.equal(await page.evaluate(() => window.fetchCalls), 0);

  console.log('Wake phrase restarts, resumes paused tasks, stays collapsed, ignores background speech, and does not speak full URLs.');
} finally { await browser.close(); }
