const $ = id => document.getElementById(id);
const PILLS = { thinking: 'Thinking', 'your-turn': 'Your turn', away: 'Paused', done: 'Done', 'needs-you': 'Needs you', error: 'Problem', permission: 'Needs access' };
let toastTimer, ready = false;

function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6000);
}
async function attempt(work) {
  try { return await work(); } catch (error) { toast(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
}

function renderStep(status) {
  const active = status && status.phase && status.phase !== 'idle';
  $('step').hidden = !active;
  if (!active) return;
  $('step-pill').textContent = PILLS[status.phase] || status.phase;
  $('step-pill').className = `pill ${status.phase}`;
  $('step-app').textContent = status.mode === 'demo' ? 'Finder demo' : status.app || '';
  $('step-message').textContent = status.message || '';
  $('step-shortcut').hidden = !status.shortcut;
  $('step-shortcut').textContent = status.shortcut ? `Shortcut: ${status.shortcut}` : '';
  $('check').hidden = !['your-turn', 'away', 'needs-you', 'error'].includes(status.phase) || status.mode === null;
  $('stop').textContent = ['done', 'error', 'permission'].includes(status.phase) ? 'Close' : 'Stop';
  if (status.phase === 'permission') $('permission-card').hidden = false;
}

function setKey(id, on, yes = 'Saved', no = 'Missing') {
  $(id).textContent = on ? yes : no;
  $(id).className = on ? 'ok' : 'missing';
}

async function refreshStatus() {
  const status = await window.wander.status();
  ready = status.server.up;
  $('server').className = `server ${status.server.up ? 'up' : 'down'}`;
  $('server-text').textContent = status.server.up ? 'Tutor ready' : 'Tutor offline';
  setKey('key-openai', status.server.keys?.openai);
  setKey('key-steel', status.server.keys?.steel);
  if (!status.helperAvailable) { $('key-ax').textContent = 'macOS only'; $('key-ax').className = 'missing'; }
  else setKey('key-ax', status.permission, 'Allowed', 'Not allowed');
  $('permission-card').hidden = !status.helperAvailable || status.permission;
  for (const id of ['ask', 'demo']) $(id).disabled = !ready || !status.helperAvailable;
  renderStep(status.tutor);
}

async function refreshApps() {
  const apps = await window.wander.listApps();
  const select = $('app'), previous = select.value;
  select.replaceChildren(...apps.map(app => {
    const option = document.createElement('option');
    option.value = String(app.pid); option.textContent = app.name; option.dataset.name = app.name;
    return option;
  }));
  if (!apps.length) {
    const option = document.createElement('option'); option.textContent = 'No apps found'; option.value = ''; select.append(option);
  }
  if (apps.some(app => String(app.pid) === previous)) select.value = previous;
}

$('refresh').addEventListener('click', () => attempt(refreshApps));
$('ask').addEventListener('click', () => attempt(async () => {
  const task = $('task').value.trim();
  const option = $('app').selectedOptions[0];
  if (!option?.value) throw new Error('Choose an app to guide.');
  if (!task) throw new Error('Type what you want to do first.');
  await window.wander.ask(task, Number(option.value), option.dataset.name);
}));
$('demo').addEventListener('click', () => attempt(() => window.wander.finderDemo()));
$('check').addEventListener('click', () => attempt(() => window.wander.check()));
$('stop').addEventListener('click', () => attempt(() => window.wander.stop()));
$('grant').addEventListener('click', () => attempt(() => window.wander.requestPermission()));
$('recheck').addEventListener('click', () => attempt(async () => {
  const { trusted } = await window.wander.recheckPermission();
  if (!trusted) toast('Accessibility is still off for Wander. Turn it on in System Settings, then check again.');
  await refreshStatus();
}));
$('settings').addEventListener('click', () => attempt(() => window.wander.openSettings()));
$('extension').addEventListener('click', () => attempt(async () => {
  await window.wander.getExtension();
  toast('In Chrome, open chrome://extensions, turn on Developer mode, click Load unpacked, and choose the highlighted folder.');
}));

window.wander.onUpdate(renderStep);
attempt(async () => { await refreshStatus(); await refreshApps(); });
setInterval(() => attempt(refreshStatus), 5000);
window.addEventListener('focus', () => attempt(refreshApps));
