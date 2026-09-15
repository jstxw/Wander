// Injected in Chrome's isolated world. This module NEVER performs a website action.
export function clearGuidance() {
  globalThis.__wanderGuideCleanup?.();
}

export function showGuidance({ action, observation, runId }) {
  globalThis.__wanderGuideCleanup?.();
  if (location.href !== observation.url) return { ok: false };
  const roots = [document];
  for (let i = 0; i < roots.length; i++) for (const e of roots[i].querySelectorAll('*')) {
    if (e.shadowRoot && !e.id.startsWith('wander-')) roots.push(e.shadowRoot);
  }
  const info = observation.elements.find(e => e.id === action.target);
  const element = info && roots.flatMap(r => [...r.querySelectorAll(`[data-wander-id="${Number(action.target)}"]`)])[0];
  const needsTarget = ['click', 'fill', 'press', 'select'].includes(action.action);
  if (needsTarget && (!element || info.disabled || info.sensitive || /\b(checkout|pay|purchase|delete|subscribe|send|publish|confirm)\b/i.test(`${info.label} ${info.href || ''}`))) return { ok: false };
  const host = document.createElement('div'); host.id = 'wander-guidance';
  host.style.cssText = 'position:fixed!important;inset:0!important;z-index:2147483646!important;pointer-events:none!important;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    *{box-sizing:border-box}.ring{position:fixed;border:3px solid #f2b233;border-radius:6px;box-shadow:0 0 0 2px #1f3a33,0 0 0 8px #f2b23355,0 0 28px #f2b23366;pointer-events:none;transition:width .12s,height .12s;}
    .hint{position:fixed;width:290px;max-width:calc(100vw - 24px);padding:14px 16px;border:1px solid #d3e6df;border-radius:10px;border-left:5px solid #f2b233;background:#fbfcfa;color:#1f3a33;box-shadow:0 8px 35px #253f3522;font:14px/1.55 'Overpass',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;pointer-events:auto;}
    .label{font-size:12px;font-weight:700;color:#3e6b5a;margin-bottom:4px}.text{overflow-wrap:anywhere}.value{margin-top:6px;color:#3e6b5a;overflow-wrap:anywhere}.actions{display:flex;gap:8px;margin-top:10px}button{font:inherit;font-size:12px;color:#1f3a33;border:1px solid #cfdad2;border-radius:6px;background:#eef2ec;padding:6px 10px;cursor:pointer}button:focus-visible{outline:2px solid #1f3a33}
    @media(prefers-reduced-motion:reduce){*{transition:none}}
  </style><div class="ring" hidden></div><aside class="hint" role="status" aria-live="polite"><div class="label">Your turn</div><div class="text"></div><div class="value"></div><div class="actions"><button class="check">Check my progress</button></div></aside>`;
  root.querySelector('.text').textContent = action.message;
  root.querySelector('.value').textContent = ['fill', 'select', 'press', 'navigate'].includes(action.action) ? action.value : '';
  document.documentElement.append(host);
  let timer, delay, finished = false;
  const finish = ok => {
    if (finished) return; finished = true;
    cleanup();
    chrome.runtime.sendMessage({ type: 'WANDER_GUIDE_RESULT', runId, actionId: action.id, ok }).catch(() => {});
  };
  const cleanup = () => {
    clearInterval(timer); clearTimeout(delay); host.remove();
    document.removeEventListener('click', clicked, true);
    document.removeEventListener('change', changed, true);
    document.removeEventListener('keydown', keyed, true);
    window.removeEventListener('scroll', scrolled, true);
    if (globalThis.__wanderGuideCleanup === cleanup) delete globalThis.__wanderGuideCleanup;
  };
  const clicked = e => {
    if (!e.isTrusted || e.composedPath().some(n => n.id === 'wander-widget' || n.id === 'wander-guidance')) return;
    if (action.action === 'click') { const matched = e.composedPath().includes(element); clearTimeout(delay); delay = setTimeout(() => finish(matched), 700); }
  };
  const changed = e => {
    if (e.isTrusted && ['fill', 'select'].includes(action.action) && e.composedPath().includes(element)) {
      clearTimeout(delay); delay = setTimeout(() => finish(true), 500);
    }
  };
  const keyed = e => {
    if (e.isTrusted && e.composedPath().includes(element) &&
        ((action.action === 'press' && e.key === action.value) || (action.action === 'fill' && e.key === 'Enter'))) {
      clearTimeout(delay); delay = setTimeout(() => finish(true), 700);
    }
  };
  const startY = scrollY;
  const scrolled = () => {
    if (action.action === 'scroll' && ((action.value === 'up' && scrollY < startY - 80) || (action.value !== 'up' && scrollY > startY + 80))) {
      clearTimeout(delay); delay = setTimeout(() => finish(true), 500);
    }
  };
  const position = () => {
    if (element && !element.isConnected) { finish(false); return; }
    const hint = root.querySelector('.hint'), ring = root.querySelector('.ring');
    const r = element?.getBoundingClientRect();
    if (r && r.width && r.height) {
      ring.hidden = false;
      Object.assign(ring.style, { left: `${r.left - 5}px`, top: `${r.top - 5}px`, width: `${r.width + 10}px`, height: `${r.height + 10}px` });
      hint.style.left = `${Math.max(12, Math.min(innerWidth - hint.offsetWidth - 12, r.left))}px`;
      hint.style.top = `${Math.max(12, Math.min(innerHeight - hint.offsetHeight - 12, r.bottom + 14 + hint.offsetHeight < innerHeight ? r.bottom + 14 : r.top - hint.offsetHeight - 14))}px`;
    } else { ring.hidden = true; hint.style.left = '18px'; hint.style.bottom = '18px'; }
  };
  root.querySelector('.check').onclick = () => finish(false);
  document.addEventListener('click', clicked, true);
  document.addEventListener('change', changed, true);
  document.addEventListener('keydown', keyed, true);
  window.addEventListener('scroll', scrolled, true);
  globalThis.__wanderGuideCleanup = cleanup;
  position(); timer = setInterval(position, 250);
  return { ok: true };
}
