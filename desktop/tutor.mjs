// Runs native Mac app lessons: snapshot the app window through the helper, ask the Node tutor for one
// step, highlight it, and re-read the window after the user acts. Also runs the fixed Finder demo.
import { EventEmitter } from 'node:events';

const RETRYABLE = new Set(['staleSnapshot', 'targetMissing', 'windowChanged', 'unknownTarget']);
const FINDER = 'com.apple.finder';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export class DesktopTutor extends EventEmitter {
  constructor({ helper, api, openFinderWindow }) {
    super();
    this.helper = helper; this.api = api; this.openFinderWindow = openFinderWindow;
    this.mode = null; this.runId = null; this.pid = null; this.appName = '';
    this.busy = false; this.queued = null; this.lastStep = null; this.demo = null;
    this.status = { mode: null, phase: 'idle', message: '', app: '', shortcut: '' };
    helper.on('event', event => this.onHelperEvent(event).catch(error => this.fail(error)));
  }

  set(patch) {
    this.status = { ...this.status, ...patch, mode: this.mode, app: this.appName };
    this.emit('update', this.status);
  }

  fail(error) {
    this.helper.call('clear').catch(() => {});
    this.set({ phase: error.code === 'permission' ? 'permission' : 'error', message: error.message, shortcut: '' });
  }

  async ensurePermission() {
    const { trusted } = await this.helper.call('permission', { prompt: false });
    if (!trusted) {
      const error = new Error('Wander needs Accessibility access to see and highlight controls in other apps.');
      error.code = 'permission'; throw error;
    }
  }

  snapshot(pid) {
    return this.helper.call('snapshot', { pid }, 15000).then(({ id, ok, ...observation }) => observation);
  }

  // Native lessons (milestone 3).

  async startLesson({ task, pid, appName }) {
    await this.stop();
    try {
      await this.ensurePermission();
      this.mode = 'lesson'; this.pid = pid; this.appName = appName || 'the app';
      this.set({ phase: 'thinking', message: `Reading ${this.appName}…`, shortcut: '' });
      const { run } = await this.api('start', { task, app: this.appName });
      this.runId = run.id;
      await this.next('check');
    } catch (error) { this.fail(error); }
  }

  check() {
    if (this.mode === 'lesson' && this.runId) return this.next('check');
    if (this.mode === 'demo') return this.demoCheck().catch(error => this.fail(error));
  }

  async next(reason) {
    if (this.busy) { this.queued = reason; return; }
    this.busy = true;
    try {
      let retried = false;
      for (;;) {
        this.set({ phase: 'thinking', message: 'Looking at the window…', shortcut: '' });
        const observation = await this.snapshot(this.pid);
        const { state, action } = await this.api('step', { runId: this.runId, observation, reason });
        if (this.mode !== 'lesson') return;
        if (!action) {
          await this.helper.call('clear');
          const status = state.run?.status;
          const phase = status === 'done' ? 'done' : status === 'waiting' ? 'needs-you' : status === 'stopped' ? 'idle' : 'error';
          this.set({ phase, message: state.run?.message || 'Wander stopped.', shortcut: '' });
          return;
        }
        try {
          const message = action.action === 'shortcut' && action.value ? `${action.message} (${action.value})` : action.message;
          await this.helper.call('highlight', { snapshotId: observation.snapshotId, controlId: action.target || null, message });
        } catch (error) {
          // The window moved on between reading and drawing: look again once instead of pointing at the wrong place.
          if (RETRYABLE.has(error.code) && !retried) { retried = true; reason = 'stale'; continue; }
          throw error;
        }
        this.lastStep = action.message;
        this.set({ phase: 'your-turn', message: action.message, shortcut: action.action === 'shortcut' ? action.value : '' });
        return;
      }
    } catch (error) {
      this.fail(error);
    } finally {
      this.busy = false;
      if (this.queued && this.mode === 'lesson') { const queued = this.queued; this.queued = null; this.next(queued); }
      else this.queued = null;
    }
  }

  async onHelperEvent(event) {
    if (event.event === 'appSwitched' && ['your-turn'].includes(this.status.phase)) {
      this.set({ phase: 'away', message: `Switch back to ${this.appName} to continue. The highlight returns when you do.` });
    } else if (event.event === 'appReturned' && this.status.phase === 'away') {
      this.set({ phase: 'your-turn', message: this.lastStep || '' });
    } else if (event.event === 'windowChanged' || event.event === 'targetLost') {
      if (this.mode === 'lesson') await this.next(event.event === 'targetLost' ? 'targetLost' : 'changed');
      else if (this.mode === 'demo') await this.demoCheck();
    }
  }

  async stop() {
    const runId = this.runId, mode = this.mode;
    this.mode = null; this.runId = null; this.demo = null; this.queued = null;
    await this.helper.call('clear').catch(() => {});
    if (mode === 'lesson' && runId) await this.api('stop', { runId }).catch(() => {});
    this.set({ phase: 'idle', message: '', shortcut: '' });
  }

  // Fixed Finder demo (milestone 2): tests targeting, the overlay and verification without the model.

  async startDemo() {
    await this.stop();
    try {
      await this.ensurePermission();
      this.mode = 'demo'; this.appName = 'Finder';
      this.set({ phase: 'thinking', message: 'Opening Finder…', shortcut: '' });
      const { apps } = await this.helper.call('listApps');
      const finder = apps.find(app => app.bundleId === FINDER);
      if (!finder) throw new Error('Finder is not running.');
      this.pid = finder.pid;
      let snapshot;
      try { snapshot = await this.snapshot(this.pid); }
      catch (error) {
        if (error.code !== 'noWindow') throw error;
        await this.openFinderWindow(); await wait(1200);
        snapshot = await this.snapshot(this.pid);
      }
      if (listViewEvidence(snapshot)) {
        this.mode = null;
        this.set({ phase: 'done', message: 'This Finder window already shows List view. Choose View > as Icons in Finder, then run the demo again.' });
        return;
      }
      this.demo = { outlines: snapshot.containerCounts?.AXOutline || 0 };
      await this.demoHighlight(snapshot);
    } catch (error) { this.fail(error); }
  }

  async demoHighlight(snapshot) {
    const step = demoTarget(snapshot);
    if (!step) throw new Error('Wander could not find the List View control in this Finder window. Make the window wider so the toolbar shows its view buttons, then try again.');
    await this.helper.call('highlight', { snapshotId: snapshot.snapshotId, controlId: step.control.id, message: step.message });
    this.lastStep = step.message;
    this.set({ phase: 'your-turn', message: step.message });
  }

  async demoCheck() {
    if (this.mode !== 'demo' || this.busy) return;
    this.busy = true;
    try {
      const snapshot = await this.snapshot(this.pid);
      if (listViewEvidence(snapshot, this.demo)) {
        await this.helper.call('clear');
        this.mode = null;
        this.set({ phase: 'done', message: 'Finder now shows List view. Wander found the control, highlighted it, and verified your change.' });
        return;
      }
      await this.demoHighlight(snapshot);
    } finally { this.busy = false; }
  }
}

const isList = label => /\blist\b/i.test(label || '') && !/playlist/i.test(label);

/** The control to highlight next: the toolbar's List view button, the open View menu's item, or the View menu. */
export function demoTarget(snapshot) {
  const controls = snapshot.controls || [];
  const button = controls.find(c => c.area === 'window' && ['AXRadioButton', 'AXButton', 'AXCheckBox'].includes(c.role) && isList(c.label));
  if (button) return { control: button, message: 'Click List View to show this folder’s files as rows you can sort.' };
  const item = controls.find(c => c.role === 'AXMenuItem' && /^as list$/i.test(c.label));
  if (item) return { control: item, message: 'Choose “as List” to switch this window to List view.' };
  const menu = controls.find(c => c.role === 'AXMenuBarItem' && c.label === 'View');
  if (menu) return { control: menu, message: 'Open the View menu in the menu bar. It lists the ways Finder can show files.' };
  return null;
}

/** True when the Finder window shows List view. `baseline` is the outline count before the demo started. */
export function listViewEvidence(snapshot, baseline = null) {
  const controls = snapshot.controls || [];
  if (controls.some(c => c.area === 'window' && ['AXRadioButton', 'AXCheckBox'].includes(c.role) && isList(c.label) && c.value === true)) return true;
  if (controls.some(c => c.area === 'window' && ['AXPopUpButton', 'AXMenuButton'].includes(c.role) && typeof c.value === 'string' && isList(c.value))) return true;
  // The sidebar is also an outline, so compare with the count from before the demo instead of checking for one.
  return Boolean(baseline) && (snapshot.containerCounts?.AXOutline || 0) > baseline.outlines;
}
