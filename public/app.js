// The settings page is silent; only the extension owns spoken guidance.
window.speechSynthesis?.cancel();
window.addEventListener('pagehide', () => window.speechSynthesis?.cancel());
const $ = id => document.getElementById(id);
let current, toastTimer;
const landing = document.querySelector('.wander-landing');
let extensionId = new URLSearchParams(location.search).get('pair') || document.documentElement.dataset.wanderExtension;
let linked = /^[a-p]{32}$/.test(extensionId || '') && Boolean(window.chrome?.runtime?.sendMessage);
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6500); }
async function api(endpoint, body = {}) {
 const response = await fetch(`/api/${endpoint}`, {method:'POST', headers:{'Content-Type':'application/json','X-Wander-Request':'1'},body:JSON.stringify(body)});
 const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed.'); return data;
}
async function extension(type, extra = {}) {
 const result = await chrome.runtime.sendMessage(extensionId, {type, ...extra});
 if (!result || result.error) throw new Error(result?.error || 'Reload the Wander extension, then reopen its Settings.'); return result;
}
async function refresh() {
 try {
  const response = await fetch('/api/state'); if (!response.ok) throw new Error(); current = await response.json();
  $('connectionLabel').textContent = 'Wander connected'; $('connectionDot').classList.add('online');
  $('landingNotice').hidden = current.configured; $('landingNotice').textContent = 'Open Settings to connect your keys.';
  for (const name of ['openai','steel','elevenlabs']) $(name+'Status').textContent = current.keys[name] ? 'Saved · leave blank to keep' : '';
  $('landingBudget').textContent = `${current.budget.spent.toFixed(3)} USD used of ${current.budget.limit.toFixed(2)} USD tracked OpenAI budget. Practice browser usage is billed separately.`;
 } catch { $('connectionLabel').textContent = 'Server unavailable'; $('connectionDot').classList.remove('online'); }
}
let selectedVoice = 'browser-default';
function loadVoices() {
 const voices = window.speechSynthesis?.getVoices() || [];
 const options = [['browser-default','Browser default'],['elevenlabs','ElevenLabs · Eric'], ...voices.filter(v => /^en/i.test(v.lang)).map(v => [v.voiceURI,v.name])];
 if (!options.some(([id]) => id === selectedVoice)) options.push([selectedVoice,selectedVoice]);
 $('voiceURI').replaceChildren(...options.map(([value,label]) => new Option(label,value)));
 $('voiceURI').value = selectedVoice;
}
$('voiceURI').onchange = () => { selectedVoice = $('voiceURI').value; };
window.speechSynthesis?.addEventListener('voiceschanged',loadVoices); loadVoices();
async function loadPreferences() {
 if (!linked) return;
 try {
  const preferences = await extension('WANDER_GET_PREFERENCES');
  $('modelMode').value = preferences.modelMode || 'dynamic'; selectedVoice = preferences.voiceURI || 'browser-default'; loadVoices();
  for (const id of ['modelMode','voiceURI','savePreferences']) $(id).disabled = false;
  $('preferencesStatus').textContent = 'Saved choices apply to Wander across your tabs. Model changes apply to new tasks.';
 } catch(error) { $('preferencesStatus').textContent = error.message; }
}
$('savePreferences').onclick = async () => {
 $('savePreferences').disabled = true;
 try { await extension('WANDER_SET_PREFERENCES',{modelMode:$('modelMode').value,voiceURI:$('voiceURI').value}); toast('Model and voice saved to your extension.'); }
 catch(error) { $('preferencesStatus').textContent = error.message; }
 finally { $('savePreferences').disabled = false; }
};
$('settingsButton').onclick = () => { $('settingsError').textContent = ''; $('settings').showModal(); loadPreferences(); };
$('closeSettings').onclick = () => $('settings').close();
$('settings').addEventListener('close', () => { for (const id of ['openaiKey','steelKey','elevenlabsKey']) $(id).value = ''; });
$('settingsForm').onsubmit = async event => {
 event.preventDefault(); $('saveKeys').disabled = true; $('settingsError').textContent = '';
 try { await api('setup',{openai:$('openaiKey').value.trim(),steel:$('steelKey').value.trim(),elevenlabs:$('elevenlabsKey').value.trim()}); await refresh(); toast('Keys saved locally.'); }
 catch(error) { $('settingsError').textContent = error.message; }
 finally { $('saveKeys').disabled = false; }
};
$('pairButton').hidden = !linked;
$('pairButton').onclick = async () => {
 try { const {token} = await api('extension-token'); await extension('WANDER_PAIR',{token}); toast('Extension connected. Return to your website to use Wander.'); }
 catch(error) { $('settingsError').textContent = error.message; }
};
$('aboutButton').onclick = () => { refresh(); $('aboutWander').showModal(); };
$('closeAbout').onclick = () => $('aboutWander').close();
refresh(); setInterval(refresh,10000);
const waypoints = [...document.querySelectorAll('.waypoint')];
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let motionPaused = motionPreference.matches, wanderTime = 0, lastFrame = 0, trailPoint, trailStops = waypoints;
function updateMotionButton() {
  document.body.classList.toggle('motion-paused', motionPaused);
  $('motionButton').setAttribute('aria-pressed', String(motionPaused));
  $('motionButton').textContent = motionPaused ? '▷  Resume motion' : 'Ⅱ  Pause motion';
}
$('motionButton').onclick = () => { motionPaused = !motionPaused; updateMotionButton(); };
motionPreference.addEventListener('change', event => { motionPaused = event.matches; updateMotionButton(); });
updateMotionButton();
function drawTerrain() {
  const w = landing.clientWidth, h = landing.clientHeight, narrow = w < 650, ns = 'http://www.w3.org/2000/svg';
  // The trail enters from the bottom edge, clear of the headline, and climbs to the top-right with a few switchbacks.
  const sway = narrow ? 24 : Math.min(h * .07, 60);
  trailPoint = narrow
    ? t => [w * (-.1 + 1.2 * t), h * (.9 - .38 * t) + Math.sin(t * Math.PI * 2.4 + .5) * sway]
    : t => [w * (.28 + .66 * t), h * (1.04 - .92 * t) + Math.sin(t * Math.PI * 2.4 + .5) * sway];
  // A phone-width trail only has room for every other question.
  trailStops = narrow ? waypoints.filter((_, index) => index % 2 === 0) : waypoints;
  waypoints.forEach(waypoint => { waypoint.hidden = !trailStops.includes(waypoint); });
  const toPath = points => 'M' + points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L');
  const shape = (className, d) => { const node = document.createElementNS(ns, 'path'); node.setAttribute('class', className); node.setAttribute('d', d); return node; };
  const cx = w * (narrow ? .8 : .74), cy = h * (narrow ? .62 : .34);
  const contours = Array.from({ length: 7 }, (_, k) => {
    const r = Math.min(w, h) * (.08 + k * .075);
    return toPath(Array.from({ length: 73 }, (_, i) => {
      const a = i / 72 * Math.PI * 2, s = 1 + .09 * Math.sin(3 * a + k * .5) + .05 * Math.sin(5 * a - k * .8);
      return [cx + Math.cos(a) * r * s * 1.25, cy + Math.sin(a) * r * s];
    })) + 'Z';
  });
  $('terrain').setAttribute('viewBox', `0 0 ${w} ${h}`);
  $('terrain').replaceChildren(...contours.map(d => shape('contour', d)), shape('trail-line', toPath(Array.from({ length: 121 }, (_, i) => trailPoint(i / 120)))));
}
function animateLanding(time) {
  if (!motionPaused && !document.hidden && !landing.hidden && lastFrame) wanderTime += Math.min(time-lastFrame, 50);
  lastFrame = time;
  trailStops.forEach((waypoint, index) => {
    // Each question walks the whole trail every 70 seconds, evenly spaced, fading at either end.
    const t = (wanderTime / 70000 + index / trailStops.length) % 1, [x, y] = trailPoint(t);
    waypoint.style.transform = `translate(${x}px, ${y}px) translate(-50%, calc(-100% - 18px))`;
    waypoint.style.opacity = String(Math.min(1, t * 8, (1 - t) * 8));
  });
  requestAnimationFrame(animateLanding);
}
drawTerrain();
addEventListener('resize', drawTerrain);
requestAnimationFrame(animateLanding);

document.addEventListener('wander-extension-ready', () => {
 extensionId = document.documentElement.dataset.wanderExtension;
 linked = /^[a-p]{32}$/.test(extensionId || '') && Boolean(window.chrome?.runtime?.sendMessage);
 $('pairButton').hidden = !linked;
 loadPreferences();
});
