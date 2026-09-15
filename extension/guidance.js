// Injected in Chrome's isolated world. It only applies safe field values after an explicit user click.
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
    *{box-sizing:border-box}.veil{position:fixed;background:rgba(242,242,247,.38);-webkit-backdrop-filter:blur(6px) saturate(65%);backdrop-filter:blur(6px) saturate(65%);pointer-events:none;transition:left .12s,top .12s,width .12s,height .12s}.ring{position:fixed;border:3px solid #0a0a0a;border-radius:14px;box-shadow:0 0 0 3px #fff,0 0 0 9px rgba(10,10,10,.16),0 14px 40px rgba(0,0,0,.28);pointer-events:none;transition:left .12s,top .12s,width .12s,height .12s;}
    .hint{position:fixed;width:290px;max-width:calc(100vw - 24px);padding:18px 20px;border:1px solid rgba(255,255,255,.7);border-radius:24px;background:rgba(255,255,255,.84);-webkit-backdrop-filter:blur(30px) saturate(180%);backdrop-filter:blur(30px) saturate(180%);color:#1d1d1f;box-shadow:0 0 0 .5px rgba(0,0,0,.1),0 20px 60px rgba(0,0,0,.22);font:15px/1.45 -apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Helvetica,Arial,sans-serif;letter-spacing:-.01em;-webkit-font-smoothing:antialiased;pointer-events:auto;}
    .label{font-size:13px;font-weight:600;color:#86868b;margin-bottom:4px}.text{font-size:17px;font-weight:600;line-height:1.3;letter-spacing:-.022em;overflow-wrap:anywhere}.value{margin-top:6px;font-size:14px;color:#6e6e73;overflow-wrap:anywhere}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}button{font:inherit;font-size:14px;font-weight:500;color:#fff;border:0;border-radius:999px;background:#0a0a0a;padding:10px 18px;cursor:pointer;transition:background .15s}button:hover{background:#2c2c2e}.check{background:rgba(0,0,0,.07);color:#1d1d1f}.check:hover{background:rgba(0,0,0,.12)}button:focus-visible{outline:2px solid #0a0a0a;outline-offset:3px}
    @media(prefers-reduced-motion:reduce){*{transition:none}}
  </style><div class="veil veil-top" hidden></div><div class="veil veil-left" hidden></div><div class="veil veil-right" hidden></div><div class="veil veil-bottom" hidden></div><div class="ring" hidden></div><aside class="hint" role="status" aria-live="polite"><div class="label">Your turn</div><div class="text"></div><div class="value"></div><div class="actions"><button class="autofill" hidden></button><button class="check">Check my progress</button></div></aside>`;
  root.querySelector('.text').textContent = action.message;
  root.querySelector('.value').textContent = ['fill', 'select', 'press', 'navigate'].includes(action.action) ? action.value : '';
  document.documentElement.append(host);
  let timer, delay, finished = false;
  const finish = ok => {
    if (finished) return; finished = true;
    cleanup();
    chrome.runtime.sendMessage({ type: 'WANDER_GUIDE_RESULT', runId, actionId: action.id, ok }).catch(() => {});
  };
  const autofill = root.querySelector('.autofill');
  const canAutofill = info?.autofillable === true && ((action.action === 'fill' && ['INPUT', 'TEXTAREA'].includes(element?.tagName)) || (action.action === 'select' && element?.tagName === 'SELECT'));
  if (canAutofill) {
    autofill.hidden = false;
    autofill.textContent = action.action === 'select' ? 'Choose it for me' : 'Fill it for me';
    autofill.onclick = () => {
      if (finished || !element?.isConnected || info.sensitive || element.disabled || element.readOnly) return finish(false);
      if (action.action === 'fill') {
        const view = element.ownerDocument.defaultView;
        const prototype = element.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (!setter) return finish(false);
        element.focus(); setter.call(element, action.value);
        element.dispatchEvent(new view.Event('input', { bubbles: true }));
        element.dispatchEvent(new view.Event('change', { bubbles: true }));
      } else {
        const option = Array.from(element.options).find(candidate => candidate.value === action.value && !candidate.disabled);
        if (!option) return finish(false);
        element.focus(); element.value = option.value;
        const view = element.ownerDocument.defaultView;
        element.dispatchEvent(new view.Event('input', { bubbles: true }));
        element.dispatchEvent(new view.Event('change', { bubbles: true }));
      }
      clearTimeout(delay); delay = setTimeout(() => finish(true), 500);
    };
  }
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
    const hint = root.querySelector('.hint'), ring = root.querySelector('.ring'), veils = [...root.querySelectorAll('.veil')];
    const r = element?.getBoundingClientRect();
    if (r && r.width && r.height) {
      const gap = 10;
      const left = Math.max(0, r.left - gap), top = Math.max(0, r.top - gap);
      const right = Math.min(innerWidth, r.right + gap), bottom = Math.min(innerHeight, r.bottom + gap);
      const setBox = (node, x, y, width, height) => {
        node.hidden = false;
        Object.assign(node.style, { left: `${x}px`, top: `${y}px`, width: `${Math.max(0, width)}px`, height: `${Math.max(0, height)}px` });
      };
      setBox(veils[0], 0, 0, innerWidth, top);
      setBox(veils[1], 0, top, left, bottom - top);
      setBox(veils[2], right, top, innerWidth - right, bottom - top);
      setBox(veils[3], 0, bottom, innerWidth, innerHeight - bottom);
      ring.hidden = false;
      Object.assign(ring.style, { left: `${r.left - 5}px`, top: `${r.top - 5}px`, width: `${r.width + 10}px`, height: `${r.height + 10}px` });
      hint.style.left = `${Math.max(12, Math.min(innerWidth - hint.offsetWidth - 12, r.left))}px`;
      hint.style.top = `${Math.max(12, Math.min(innerHeight - hint.offsetHeight - 12, r.bottom + 14 + hint.offsetHeight < innerHeight ? r.bottom + 14 : r.top - hint.offsetHeight - 14))}px`;
    } else { ring.hidden = true; veils.forEach(veil => { veil.hidden = true; }); hint.style.left = '18px'; hint.style.bottom = '18px'; }
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
