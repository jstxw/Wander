// Wander desktop (Electron 33). Starts the existing Node server as a utility process with Electron's
// bundled Node, runs the Swift Accessibility helper, and shows the Wander window.
import { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess } from 'electron';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Helper } from './helper.mjs';
import { DesktopTutor } from './tutor.mjs';

const PORT = 4318;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const resources = app.isPackaged ? process.resourcesPath : null;
// A new token each launch; only this process and the server know it.
const desktopToken = randomBytes(32).toString('hex');

const helper = new Helper(resources ? path.join(resources, 'wander-helper') : path.join(appRoot, 'build', 'wander-helper'));
let server = null, window = null, quitting = false;

// MARK: server

function serverEnv() {
  const env = { ...process.env, PORT: String(PORT), WANDER_DESKTOP_TOKEN: desktopToken };
  if (app.isPackaged) {
    // The app bundle is read-only, so state and keys live in ~/Library/Application Support/Wander.
    const data = app.getPath('userData');
    env.WANDER_DATA_DIR = path.join(data, 'state');
    env.WANDER_ENV_FILE = path.join(data, '.env.local');
    env.WANDER_PYTHON_HOME = path.join(resources, 'python');
  }
  return env;
}

async function serverState() {
  try {
    const response = await fetch(`${ORIGIN}/api/state`, { signal: AbortSignal.timeout(1500) });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

async function startServer() {
  if (await serverState()) {
    throw new Error(`Another copy of Wander is already using port ${PORT}, probably one started with npm start. Close it, then open Wander again.`);
  }
  let exited = null;
  server = utilityProcess.fork(path.join(appRoot, 'server', 'index.mjs'), [], { env: serverEnv(), serviceName: 'Wander tutor', stdio: 'inherit' });
  server.once('exit', code => {
    exited = code; server = null;
    if (!quitting && window) { dialog.showErrorBox('Wander stopped', `Wander’s tutor exited (code ${code}). Open Wander again to restart it.`); app.quit(); }
  });
  for (const started = Date.now(); Date.now() - started < 20000;) {
    if (exited !== null) throw new Error(`Wander’s tutor exited while starting (code ${exited}). Check whether port ${PORT} is in use.`);
    if (await serverState()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Wander’s tutor did not start within 20 seconds.');
}

async function desktopApi(endpoint, body = {}) {
  let response;
  try {
    response = await fetch(`${ORIGIN}/api/desktop/${endpoint}`, {
      method: 'POST', headers: { Authorization: `Bearer ${desktopToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(120000)
    });
  } catch { throw new Error('Wander’s tutor is not responding.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Tutor request failed (HTTP ${response.status}).`);
  return data;
}

// MARK: tutor and IPC

const tutor = new DesktopTutor({ helper, api: desktopApi, openFinderWindow: () => shell.openPath(os.homedir()) });
tutor.on('update', status => window?.webContents.send('wander:update', status));

async function permission(prompt = false) {
  if (!helper.available) return null;
  try { return (await helper.call('permission', { prompt })).trusted; } catch { return false; }
}

function handle(channel, work) {
  ipcMain.handle(channel, (event, ...args) => {
    // Only the Wander window may call these.
    if (!window || event.sender !== window.webContents) throw new Error('Not allowed.');
    return work(...args);
  });
}

handle('wander:status', async () => {
  const state = await serverState();
  return {
    server: { up: Boolean(state), keys: state?.keys || {}, run: state?.run || null },
    helperAvailable: helper.available, permission: await permission(), tutor: tutor.status
  };
});
handle('wander:listApps', async () => {
  if (!helper.available) return [];
  const { apps } = await helper.call('listApps');
  return apps
    .filter(item => item.pid !== process.pid && item.name && item.name !== 'Wander' && item.name !== 'Electron')
    .sort((a, b) => a.name.localeCompare(b.name));
});
handle('wander:requestPermission', async () => {
  await helper.call('permission', { prompt: true });
  await helper.call('openAccessibilitySettings');
  return { ok: true };
});
handle('wander:recheckPermission', async () => {
  // macOS reports a newly granted permission reliably only to a freshly started process.
  if (helper.available) helper.restart();
  return { trusted: await permission() };
});
handle('wander:ask', async params => {
  const task = typeof params?.task === 'string' ? params.task.trim().slice(0, 1500) : '';
  const pid = Number.isInteger(params?.pid) && params.pid > 0 ? params.pid : null;
  if (!task || !pid) throw new Error('Choose an app and type a question first.');
  tutor.startLesson({ task, pid, appName: String(params.appName || '').slice(0, 80) });
  return { ok: true };
});
handle('wander:check', async () => { await tutor.check(); return { ok: true }; });
handle('wander:stop', async () => { await tutor.stop(); return { ok: true }; });
handle('wander:finderDemo', async () => { tutor.startDemo(); return { ok: true }; });
handle('wander:openSettings', async () => { await shell.openExternal(ORIGIN); return { ok: true }; });
handle('wander:getExtension', async () => {
  // Chrome's folder picker cannot look inside an app bundle, so copy the extension somewhere it can.
  const source = resources ? path.join(resources, 'extension') : path.join(appRoot, 'extension');
  const target = path.join(app.getPath('userData'), 'chrome-extension');
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
  shell.showItemInFolder(target);
  return { path: target };
});

// MARK: window and lifecycle

function createWindow() {
  window = new BrowserWindow({
    width: 820, height: 760, minWidth: 560, minHeight: 520, title: 'Wander', show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { window = null; });
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.loadFile(path.join(here, 'renderer', 'index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    try { await startServer(); }
    catch (error) { dialog.showErrorBox('Wander could not start', error.message); quitting = true; server?.kill(); app.quit(); return; }
    if (helper.available) { try { helper.start(); } catch (error) { console.error(error); } }
    createWindow();
    // macOS convention: closing the window keeps Wander running for the Chrome extension.
    app.on('activate', () => { if (!window) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', event => {
    helper.stop(); // closing its input makes the helper remove any highlight and exit
    if (!server || quitting) return;
    // Let the tutor stop the active lesson and release the practice browser before exiting.
    event.preventDefault(); quitting = true;
    const child = server;
    const force = setTimeout(() => child.kill(), 13000);
    child.once('exit', () => { clearTimeout(force); app.quit(); });
    child.postMessage('shutdown');
  });
}
