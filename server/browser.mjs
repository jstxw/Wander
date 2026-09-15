import { snapshotPage } from '../extension/page-tools.js';
import { chromium } from 'playwright';
import fs from 'node:fs';
import { saveJson } from './budget.mjs';

export function allowedUrl(value) {
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password;
  } catch { return false; }
}

export const checkoutPattern = /\b(check\s*out|checkout|place\s+(?:my\s+)?order|pay\s+now|confirm\s+(?:my\s+)?order|complete\s+purchase|subscribe|passer\s+(?:la\s+)?commande|paiement|payer)\b/i;

export class SteelBrowser {
  constructor({ key, stateFile, notify }) { this.key = key; this.stateFile = stateFile; this.notify = notify; this.session = null; this.browser = null; }
  async api(endpoint, method = 'GET', body) {
    const response = await fetch(`https://api.steel.dev/v1${endpoint}`, {
      method, headers: { 'steel-api-key': this.key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`Steel request failed (HTTP ${response.status}). Check your key, credits, or profile readiness.`);
    return response.status === 204 ? {} : response.json();
  }
  async start() {
    if (this.session && this.browser?.isConnected()) return this.publicState();
    if (this.session) await this.release();
    const saved = fs.existsSync(this.stateFile) ? JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) : {};
    if (saved.sessionId) {
      // Recover orphaned sessions after a local server restart rather than losing profile changes.
      try { await this.api(`/sessions/${saved.sessionId}/release`, 'POST'); } catch { /* May already be expired. */ }
    }
    if (saved.profileId) {
      const profile = await this.api(`/profiles/${saved.profileId}`);
      if (String(profile.status).toUpperCase() !== 'READY') throw new Error('Your browser profile is still saving or unavailable. Wait a moment and try again.');
    }
    const session = await this.api('/sessions', 'POST', {
      solveCaptcha: true,
      timeout: 900000, persistProfile: true, dimensions: { width: 1366, height: 900 },
      ...(saved.profileId ? { profileId: saved.profileId } : {}), debugConfig: { interactive: true }
    });
    this.session = session;
    this.startedAt = Date.now();
    saveJson(this.stateFile, { profileId: session.profileId, sessionId: session.id });
    try {
      this.browser = await chromium.connectOverCDP(`wss://connect.steel.dev?apiKey=${encodeURIComponent(this.key)}&sessionId=${encodeURIComponent(session.id)}`, { timeout: 30000 });
      this.context = this.browser.contexts()[0];
      if (!this.context) throw new Error('Steel did not provide a browser context.');
      this.context.setDefaultTimeout(8000);
      this.page = this.context.pages()[0] || await this.context.newPage();
      await this.context.route('**/*', async route => {
        const req = route.request();
        if (req.isNavigationRequest() && req.frame() === req.frame().page().mainFrame() && !allowedUrl(req.url()) && req.url() !== 'about:blank') {
          await route.abort();
        } else await route.continue();
      });
      this.context.on('page', page => { this.page = page; });
      this.browser.on('disconnected', () => this.notify('Browser connection ended. Reconnect to continue.'));
      await this.page.goto('https://www.metro.ca/en', { waitUntil: 'domcontentloaded', timeout: 30000 });
      return this.publicState();
    } catch (error) {
      await this.release().catch(() => {});
      // CDP exceptions may contain the authenticated WebSocket URL.
      throw new Error('Could not connect to the Steel browser or open Metro. Check Steel’s dashboard and retry.');
    }
  }
  publicState() {
    if (!this.session) return null;
    const raw = this.session.debugUrl || this.session.sessionViewerUrl;
    let viewerUrl = null;
    if (raw) {
      const u = new URL(raw);
      if (u.protocol === 'https:' && (u.hostname === 'steel.dev' || u.hostname.endsWith('.steel.dev'))) {
        u.searchParams.set('interactive', 'true'); viewerUrl = u.href;
      }
    }
    return { id: this.session.id, viewerUrl, connected: Boolean(this.browser?.isConnected()), expiresAt: this.startedAt + 900000 };
  }
  async release() {
    if (!this.session) return;
    const current = this.session;
    await this.api(`/sessions/${current.id}/release`, 'POST');
    await this.browser?.close().catch(() => {});
    saveJson(this.stateFile, { profileId: current.profileId });
    this.session = null; this.browser = null; this.page = null;
  }
}

export async function observe(page) {
  if (!page || page.isClosed()) throw new Error('Browser tab is closed. Reconnect your browser.');
  return page.evaluate(snapshotPage);
}

export async function execute(page, action, observation) {
  if (action.action === 'navigate') {
    if (!allowedUrl(action.value) || checkoutPattern.test(action.value)) throw new Error('Only ordinary HTTP/HTTPS destinations are supported.');
    await page.goto(action.value, { waitUntil: 'domcontentloaded', timeout: 25000 }); return;
  }
  if (action.action === 'wait') { await new Promise(resolve => setTimeout(resolve, 1200)); return; }
  if (action.action === 'scroll') { await page.mouse.wheel(0, action.value === 'up' ? -600 : 600); return; }
  if (!['click', 'fill', 'press', 'select'].includes(action.action)) throw new Error('Unsupported browser action.');
  const info = observation.elements.find(el => el.id === action.target);
  if (!info || info.disabled || info.sensitive) throw new Error('Element unavailable or requires human input.');
  if (checkoutPattern.test(`${info.label} ${info.href || ''}`)) throw new Error('Checkout needs manual control. The agent only adds to cart.');
  const target = page.locator(`[data-wander-id="${action.target}"]`);
  if (await target.count() !== 1) throw new Error('Page changed. Observe again before acting.');
  if (action.action === 'click') await target.click();
  if (action.action === 'fill') await target.fill(action.value);
  if (action.action === 'select') await target.selectOption(action.value);
  if (action.action === 'press') {
    if (!['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp'].includes(action.value)) throw new Error('Unsupported key.');
    await target.press(action.value);
  }
}
