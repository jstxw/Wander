// Client for the Swift Accessibility helper (native/wander-helper.swift): one JSON object per line
// over stdin/stdout. Requests carry an id; unsolicited lines are events such as windowChanged.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import readline from 'node:readline';

export class HelperError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export class Helper extends EventEmitter {
  constructor(executable) {
    super();
    this.executable = executable; this.child = null; this.pending = new Map(); this.nextId = 1;
  }

  get available() { return process.platform === 'darwin' && fs.existsSync(this.executable); }

  start() {
    if (this.child) return;
    if (!this.available) throw new HelperError('missing', 'The Mac helper is not available in this build.');
    const child = spawn(this.executable, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.child = child;
    readline.createInterface({ input: child.stdout }).on('line', line => { if (this.child === child) this.receive(line); });
    child.on('error', error => console.error('Mac helper failed to start:', error.message));
    child.stdin.on('error', () => {}); // the helper exited; its exit handler fails pending requests
    child.on('exit', code => {
      if (this.child === child) this.child = null;
      // Fail only this process's requests; after a restart, newer requests belong to the new helper.
      for (const [id, request] of this.pending) {
        if (request.child !== child) continue;
        clearTimeout(request.timer); this.pending.delete(id);
        request.reject(new HelperError('exited', `The Mac helper stopped (code ${code}).`));
      }
      this.emit('exit', code);
    });
  }

  receive(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.event) { this.emit('event', message); return; }
    const request = this.pending.get(message.id);
    if (!request) return;
    this.pending.delete(message.id); clearTimeout(request.timer);
    if (message.ok) request.resolve(message);
    else request.reject(new HelperError(message.code || 'error', message.error || 'The Mac helper reported an error.'));
  }

  call(cmd, params = {}, timeout = 10000) {
    this.start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new HelperError('timeout', `The Mac helper did not answer ${cmd} in time.`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer, child: this.child });
      this.child.stdin.write(`${JSON.stringify({ id, cmd, ...params })}\n`);
    });
  }

  /** Restarts the helper; macOS can report a fresh Accessibility grant only to a new process. */
  restart() { this.stop(); this.start(); }

  stop() {
    const child = this.child;
    if (!child) return;
    this.child = null;
    try { child.stdin.end(); } catch {}
    setTimeout(() => { if (child.exitCode === null) child.kill(); }, 1000).unref();
  }
}
