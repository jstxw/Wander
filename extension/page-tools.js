export function snapshotPage() {
    const clean = s => (s || '').replace(/\s+/g, ' ').trim();
    const visible = el => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const roots = [document];
    for (let i = 0; i < roots.length; i++) for (const el of roots[i].querySelectorAll('*')) if (el.shadowRoot && !['wander-widget', 'wander-guidance'].includes(el.id)) roots.push(el.shadowRoot);
    const queryAll = selector => roots.flatMap(root => Array.from(root.querySelectorAll(selector)));
    queryAll('[data-wander-id]').forEach(el => el.removeAttribute('data-wander-id'));
    const elements = [];
    for (const el of queryAll('a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=tab],[role=radio],[role=checkbox],[role=option],[role=menuitem],[role=combobox],[role=spinbutton],[tabindex="0"],[contenteditable=true]')) {
      if (elements.length >= 65) break;
      if (!visible(el) || el.closest('#wander-widget,#wander-guidance')) continue;
      const id = elements.length + 1;
      el.setAttribute('data-wander-id', String(id));
      const label = clean(el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('data-tooltip') || el.innerText || el.textContent);
      const sensitive = el.type === 'password' || /password|credit.card|card.number|security.code|one.time|one-time/i.test(`${el.name} ${el.autocomplete} ${label}`);
      const personal = /^(?:email|tel)$/i.test(el.type) || /(?:^|\s)(?:name|given-name|family-name|email|tel|street-address|address-line\d|postal-code|cc-[\w-]+|bday(?:-[\w-]+)?|sex|webauthn)(?:\s|$)/i.test(el.autocomplete || '') || /\b(?:e-?mail|phone|telephone|street address|mailing address|postal code|zip code|first name|last name|full name|date of birth|birth date|social security|ssn|passport|driver'?s licen[cs]e|account number|routing number|iban)\b/i.test(`${el.name} ${label}`);
      const autofillable = !sensitive && !personal && !el.disabled && !el.readOnly && (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && ['', 'text', 'search', 'number', 'url'].includes(el.type)));
      elements.push({ id, tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), type: el.type || '', label: label.slice(0, 140), sensitive, autofillable, disabled: Boolean(el.disabled), readOnly: Boolean(el.readOnly),
        ...(el.tagName === 'A' ? { href: el.href.slice(0, 250) } : {}),
        ...(el.tagName === 'SELECT' ? { options: Array.from(el.options).slice(0, 15).map(o => ({ text: clean(o.text).slice(0, 60), value: o.value.slice(0, 60) })) } : {}),
        ...(!sensitive && (el.type === 'number' || el.getAttribute('role') === 'spinbutton' || /quantity|qty|quantité/i.test(`${label} ${el.name} ${el.id}`)) ? { value: String(el.value ?? el.getAttribute('aria-valuenow') ?? '').slice(0, 30), min: el.min || el.getAttribute('aria-valuemin'), max: el.max || el.getAttribute('aria-valuemax'), step: el.step } : {}),
        context: clean(el.closest('article,[class*=product],[class*=tile],li,form')?.innerText || el.parentElement?.innerText).slice(0, 260)
      });
    }
    // Visible text only. Never serialize form values, hidden inputs, scripts or cookies.
    const parts = []; let length = 0;
    for (const scope of roots) {
    const walker = document.createTreeWalker(scope === document ? document.body : scope, NodeFilter.SHOW_TEXT);
    while (walker.nextNode() && length < 6500) {
      const node = walker.currentNode, parent = node.parentElement;
      if (!parent || parent.closest('script,style,noscript,textarea,input,[contenteditable=true],#wander-widget,#wander-guidance') || !visible(parent)) continue;
      const text = clean(node.textContent);
      if (text) { parts.push(text); length += text.length; }
    }
    }
    return { readyState: document.readyState, url: location.href, title: document.title, text: parts.join(' ').slice(0, 6500), elements };
}

export function actOnPage({ action, observation }) {
  if (location.href !== observation.url) return { ok: false, reason: 'Page changed.' };
  if (action.action === 'wait') return { ok: true };
  if (action.action === 'scroll') { window.scrollBy({ top: action.value === 'up' ? -600 : 600, behavior: 'instant' }); return { ok: true }; }
  if (!['click', 'fill', 'press', 'select'].includes(action.action)) return { ok: false };
  const info = observation.elements.find(el => el.id === action.target);
  if (!info || info.sensitive || info.disabled || /\b(check\s*out|checkout|place\s+(?:my\s+)?order|pay\s+now|confirm\s+(?:my\s+)?order|complete\s+purchase|subscribe|passer\s+(?:la\s+)?commande|paiement|payer)\b/i.test(`${info.label} ${info.href || ''}`)) return { ok: false };
  const roots = [document];
  for (let i = 0; i < roots.length; i++) for (const el of roots[i].querySelectorAll('*')) if (el.shadowRoot && el.id !== 'wander-widget') roots.push(el.shadowRoot);
  const element = roots.map(root => root.querySelector(`[data-wander-id="${Number(action.target)}"]`)).find(Boolean);
  if (!element || element.disabled || element.type === 'password') return { ok: false };
  if (action.action === 'click') {
    if (element.href) { const u = new URL(element.href); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return { ok: false }; }
    element.click();
  }
  if (action.action === 'fill') {
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter || !['INPUT', 'TEXTAREA'].includes(element.tagName)) return { ok: false };
    element.focus(); setter.call(element, action.value); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (action.action === 'select') {
    if (element.tagName !== 'SELECT' || !Array.from(element.options).some(option => option.value === action.value)) return { ok: false };
    element.value = action.value; element.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (action.action === 'press') {
    if (!['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp'].includes(action.value)) return { ok: false };
    element.focus();
    const accepted = element.dispatchEvent(new KeyboardEvent('keydown', { key: action.value, code: action.value, bubbles: true, cancelable: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key: action.value, code: action.value, bubbles: true }));
    if (action.value === 'Enter' && accepted && element.form) element.form.requestSubmit();
  }
  return { ok: true };
}
