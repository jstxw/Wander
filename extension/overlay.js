(() => {
  if (location.origin === 'http://127.0.0.1:4318') {
    document.documentElement.dataset.wanderExtension = chrome.runtime.id;
    document.dispatchEvent(new Event('wander-extension-ready'));
    return;
  }
  if (location.origin === 'http://localhost:4318') return;
  if (document.getElementById('wander-widget')) return;
  const host = document.createElement('div'); host.id = 'wander-widget';
  host.style.cssText = 'all:initial!important;position:fixed!important;top:50%!important;right:18px!important;transform:translateY(-50%)!important;z-index:2147483647!important;display:block!important;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    :host{color-scheme:light}*{box-sizing:border-box}button,input,textarea{font:inherit;letter-spacing:inherit}button{cursor:pointer;border:0}button:disabled{opacity:.35;cursor:default}[hidden]{display:none!important}
    .wrap{font:15px/1.47 -apple-system,BlinkMacSystemFont,'SF Pro Text','SF Pro Display','Helvetica Neue',Helvetica,Arial,sans-serif;letter-spacing:-.01em;-webkit-font-smoothing:antialiased;color:#1d1d1f;width:372px;max-width:calc(100vw - 36px);display:flex;flex-direction:column;align-items:flex-end;gap:14px}
    .orb-button{position:relative;width:64px;height:64px;border-radius:50%;padding:0;background:#0a0a0a;display:grid;place-items:center;box-shadow:inset 0 0 0 1px rgba(255,255,255,.16),0 10px 30px rgba(0,0,0,.28),0 2px 6px rgba(0,0,0,.16);transition:transform .2s cubic-bezier(.2,.8,.2,1),box-shadow .2s}
    .orb-button:hover{transform:scale(1.04)}.orb-button:active{transform:scale(.96)}
    .orb-button:after{content:'';position:absolute;inset:0;border-radius:50%;pointer-events:none}
    .orb-button.listening{box-shadow:0 0 0 3px #fff,0 0 0 5px #0a0a0a,0 10px 30px rgba(0,0,0,.28)}
    .orb-button.listening:after{animation:ripple 1.8s cubic-bezier(.2,.8,.2,1) infinite}
    .orb-button.speaking{box-shadow:0 0 0 3px #fff,0 10px 30px rgba(0,0,0,.28)}
    .orb-button.speaking:after{animation:ripple 1.1s cubic-bezier(.2,.8,.2,1) infinite}
    @keyframes ripple{from{box-shadow:0 0 0 3px rgba(120,120,128,.55)}to{box-shadow:0 0 0 18px rgba(120,120,128,0)}}
    .blaze{width:30px;height:30px;display:block}.blaze rect{fill:#fff;transform-box:fill-box}
    .orb-button.working .b1{animation:hop 1.1s ease-in-out infinite}.orb-button.working .b2{animation:hop 1.1s ease-in-out -.55s infinite}@keyframes hop{50%{transform:translateY(-3px)}}
    .card{position:relative;width:100%;max-height:calc(100vh - 120px);overflow:auto;scrollbar-width:none;border-radius:32px;border:1px solid rgba(255,255,255,.7);background:radial-gradient(120% 80% at 0% 0%,rgba(255,255,255,.95),rgba(255,255,255,0) 60%),radial-gradient(90% 70% at 100% 100%,rgba(226,226,231,.75),rgba(226,226,231,0) 70%),radial-gradient(60% 50% at 100% 0%,rgba(242,242,245,.8),rgba(242,242,245,0) 70%),rgba(250,250,252,.8);-webkit-backdrop-filter:blur(40px) saturate(180%);backdrop-filter:blur(40px) saturate(180%);box-shadow:0 0 0 .5px rgba(0,0,0,.08),0 30px 80px rgba(0,0,0,.22),0 8px 24px rgba(0,0,0,.08),inset 0 1px 0 rgba(255,255,255,.9);animation:rise .34s cubic-bezier(.2,.8,.2,1)}
    .card::-webkit-scrollbar{display:none}@keyframes rise{from{opacity:0;transform:translateY(8px) scale(.98)}}
    .head{padding:22px 22px 0 26px;display:flex;align-items:center;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none}.orb-button{touch-action:none}.wrap.dragging .head,.wrap.dragging .orb-button{cursor:grabbing}.wrap.dragging .orb-button{transform:none}
    .brand{font-size:15px;font-weight:600;letter-spacing:-.02em;display:flex;align-items:center;gap:9px}.brand svg{width:26px;height:26px}
    .minimize{margin-left:auto;width:32px;height:32px;border-radius:50%;background:rgba(0,0,0,.05);color:#6e6e73;font-size:18px;line-height:1;display:grid;place-items:center;transition:background .15s}.minimize:hover{background:rgba(0,0,0,.09)}
    .body{padding:30px 26px 22px}
    .status{font-size:32px;line-height:1.08;font-weight:600;letter-spacing:-.035em;color:#1d1d1f;margin:0 0 12px;max-height:250px;overflow:auto;white-space:pre-wrap;scrollbar-width:none}
    .status.long{font-size:20px;line-height:1.3;letter-spacing:-.022em;font-weight:500}
    .subtitle{font-size:15px;line-height:1.4;color:#86868b;margin:0 0 30px}
    .setup{width:100%;height:52px;border-radius:999px;background:#0a0a0a;color:#fff;font-size:16px;font-weight:500;margin-bottom:12px}
    .task{display:flex;align-items:flex-end;gap:8px;border-radius:26px;background:rgba(255,255,255,.88);box-shadow:inset 0 0 0 1px rgba(0,0,0,.08);padding:8px 8px 8px 18px;transition:box-shadow .2s}.task:focus-within{box-shadow:inset 0 0 0 1.5px #1d1d1f}
    .task textarea{resize:none;width:100%;min-width:0;min-height:52px;border:0;outline:0;padding:8px 0;font-size:15px;line-height:1.4;color:#1d1d1f;background:transparent}.task textarea::placeholder{color:#a1a1a6}
    .send{width:36px;height:36px;border-radius:50%;background:#0a0a0a;color:#fff;font-size:18px;flex-shrink:0;display:grid;place-items:center;transition:background .15s,transform .15s}.send:disabled{background:rgba(0,0,0,.14);opacity:1}
    .actions{display:flex;gap:8px;margin-top:12px}
    .mic{flex:1;min-width:0;height:44px;padding:0 16px;border-radius:999px;background:#0a0a0a;color:#fff;font-size:15px;font-weight:500;white-space:nowrap;display:flex;align-items:center;justify-content:center;gap:8px;transition:background .2s,color .2s,box-shadow .2s,transform .15s}.mic svg{width:18px;height:18px}.mic:hover{background:#2c2c2e}
    .mic.live{background:#fff;color:#0a0a0a;box-shadow:inset 0 0 0 2px #0a0a0a}
    .secondary{height:44px;padding:0 16px;flex-shrink:0;white-space:nowrap;border-radius:999px;background:rgba(0,0,0,.05);color:#1d1d1f;font-size:15px;font-weight:500;transition:background .15s,transform .15s}.secondary:hover{background:rgba(0,0,0,.09)}
    .wake{display:block;width:auto;height:30px;margin:12px auto 0;padding:0 14px;font-size:12px;color:#6e6e73}
    .mic:active,.secondary:active,.send:active,.setup:active{transform:scale(.98)}
    .caption{font-size:12px;color:#86868b;text-align:center;margin-top:16px}
    .footer{display:flex;justify-content:space-between;align-items:center;gap:12px;border-top:.5px solid rgba(0,0,0,.08);padding:14px 22px 18px 26px;color:#86868b;font-size:12px;font-variant-numeric:tabular-nums}
    .footer button{background:rgba(0,0,0,.05);color:#1d1d1f;font-size:12px;font-weight:500;padding:7px 14px;border-radius:999px;transition:background .15s}.footer button:hover{background:rgba(0,0,0,.09)}
    button:focus-visible{outline:2px solid #0a0a0a;outline-offset:3px}
    @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
  </style><div class="wrap"><button class="orb-button" id="orb" aria-label="Open Wander chat" title="Wander · click to open"><svg class="blaze" viewBox="0 0 32 32" aria-hidden="true"><rect class="b1" x="16.5" y="4" width="7" height="11" rx="3"/><rect class="b2" x="8.5" y="17" width="7" height="11" rx="3"/></svg></button><section class="card" id="card" hidden><div class="head"><span class="brand"><svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="10" fill="#0a0a0a"/><rect x="16" y="6" width="6" height="9" rx="2.5" fill="#fff"/><rect x="10" y="17" width="6" height="9" rx="2.5" fill="#fff"/></svg>Wander</span><button class="minimize" id="minimize" aria-label="Minimize chat">−</button></div><div class="body"><div class="status" id="status" role="status">What would you like to do on the web?</div><p class="subtitle">Your tab. Your voice. A little less clicking.</p><button class="setup" id="setup" hidden>Connect Wander</button><form class="task" id="form"><textarea id="task" rows="2" maxlength="1500" placeholder="Find school supplies, compare prices…" aria-label="Your instruction"></textarea><button class="send" id="send" type="submit" aria-label="Send instruction">↑</button></form><div class="actions"><button class="mic" id="mic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><span id="micLabel">Talk to Wander</span></button><button class="secondary" id="pause" hidden>Pause</button><button class="secondary" id="resume" hidden>Resume</button><button class="secondary" id="stop" hidden>Stop</button></div><button class="secondary wake" id="wake">Enable “Hello Wander”</button><div class="caption" id="caption">Send = new task · Resume = continue</div></div><div class="footer"><span id="budget">Luna · $1.80 budget</span><button id="settings">Settings</button></div></section></div>`;
  document.documentElement.append(host);
  const $ = id => root.getElementById(id);
  root.querySelector('.subtitle').textContent = 'Learn the web, one highlighted step at a time.';
  $('task').placeholder = 'Show me how to use this website…';
  // Short prompts read as a headline; long run messages drop to body size so the card stays calm.
  new MutationObserver(() => $('status').classList.toggle('long', $('status').textContent.length > 60)).observe($('status'), { childList: true, characterData: true, subtree: true });
  let state, paired = true, selected = true, busy = false, listening = false, wakeListening = false, recognition, transcript = '', spoken = new Set();
  const send = async (type, extra = {}) => {
    let response;
    try { response = await chrome.runtime.sendMessage({ type, ...extra }); } catch { throw new Error('Extension reloaded. Refresh this page and click Wander again.'); }
    if (response?.error) throw new Error(response.error);
    if (response?.selected !== undefined) selected = response.selected;
    if (response?.state) { state = response.state; render(type === 'WANDER_STATUS'); }
    return response;
  };
  function render(silent = false) {
    const run = selected && state?.run?.mode === 'local' ? state.run : null;
    const working = run?.status === 'running', paused = ['paused', 'waiting'].includes(run?.status);
    $('orb').classList.toggle('working', working && run.phase !== 'your-turn'); $('orb').classList.toggle('listening', listening || wakeListening);
    $('pause').hidden = !working; $('resume').hidden = !paused; $('stop').hidden = !working && !paused;
    $('setup').hidden = paired;
    $('send').disabled = busy || working || !paired; $('mic').disabled = busy || !paired;
    $('budget').textContent = state ? `${run?.model?.replace('gpt-5.6-', '').replace('gpt-6-', '') || modelMode} · $${state.budget.spent.toFixed(3)} / $1.80` : 'Luna · $1.80 budget';
    if (run?.message && !listening && !wakeListening) $('status').textContent = run.message;
    if (!paired) $('status').textContent = 'Connect this extension to your local Wander server once. Your API keys stay out of Chrome.';
    if (working) $('caption').textContent = run.phase === 'your-turn' ? 'Your turn: follow the highlight on the page' : 'Wander is checking the website in its own browser';
    else $('caption').textContent = 'Ask for a task · learn by doing';
    if (run && ['running', 'waiting', 'done', 'error', 'limited'].includes(run.status)) {
      const id = `${run.id}:${run.message}`;
      if (!spoken.has(id)) {
        spoken.add(id);
        if (!silent && !listening && !wakeListening && 'speechSynthesis' in window) speak(run.message, run.status === 'waiting' ? run.id : null, id);
      }
    }
  }
  let voices = [], savedVoice = '', elevenActive = false;
  let wakeEnabled = false, wakeBlocked = false, wakeRecognition, wakeTimer, commandTimer, awaitingCommand = false, wakeCommand = '', wakePhraseTail = '', wakePhraseTailAt = 0, speaking = false, speechGeneration = 0;
  function loadVoices() { voices = speechSynthesis.getVoices(); }
  function cancelSpeech() {
    speechGeneration++; speaking = false; speechSynthesis.cancel();
    if (elevenActive) { elevenActive = false; chrome.runtime.sendMessage({ type: 'WANDER_CANCEL_SPEECH' }).catch(() => {}); }
    $('orb').classList.remove('speaking');
  }
  function speechText(text) {
    return String(text || '')
      .replace(/\b(?:https?|wss?):\/\/[^\s<>()]+/gi, 'the website')
      .replace(/\bwww\.[^\s<>()]+/gi, 'the website')
      .replace(/\s+([,.;!?])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  function finishSpeech(generation, questionRunId) {
    if (generation !== speechGeneration) return;
    speaking = false; elevenActive = false;
    $('orb').classList.remove('speaking');
    if (questionRunId && selected && state?.run?.id === questionRunId && state.run.status === 'waiting' && !document.hidden) $('mic').onclick();
    else scheduleWake();
  }
  async function playElevenLabs(text, generation, questionRunId) {
    elevenActive = true;
    await send('WANDER_SPEAK', { text });
    finishSpeech(generation, questionRunId);
  }
  async function speak(text, questionRunId = null, speechId = '') {
    await preferencesReady;
    const safeText = speechText(text); if (!safeText) return;
    cancelSpeech(); const generation = ++speechGeneration;
    speaking = true; wakeRecognition?.abort();
    if (speechId) {
      try {
        const claim = await send('WANDER_CLAIM_SPEECH', { speechId });
        if (generation !== speechGeneration) return;
        if (!claim?.claimed) { finishSpeech(generation, null); return; }
      } catch (error) {
        if (generation !== speechGeneration) return;
        $('caption').textContent = error.message;
        finishSpeech(generation, null); return;
      }
    }
    if (savedVoice === 'elevenlabs') {
      $('orb').classList.add('speaking');
      try {
        await playElevenLabs(safeText, generation, questionRunId);
        if (generation !== speechGeneration) return;
      } catch (error) {
        if (generation !== speechGeneration) return;
        $('caption').textContent = `${error?.message || 'ElevenLabs voice is unavailable.'} Choose a browser voice or add your ElevenLabs key in Settings.`;
        finishSpeech(generation, null);
      }
      return;
    }
    const speech = new SpeechSynthesisUtterance(safeText);
    speech.voice = voices.find(v => v.voiceURI === savedVoice) || null;
    speech.lang = speech.voice?.lang || 'en-US'; speech.rate = 1.02;
    speech.onstart = () => { if (generation === speechGeneration) $('orb').classList.add('speaking'); };
    speech.onend = () => finishSpeech(generation, questionRunId);
    speech.onerror = event => { if (generation !== speechGeneration) return; speaking = false; scheduleWake(); $('orb').classList.remove('speaking'); if (!['interrupted', 'canceled'].includes(event.error)) $('caption').textContent = 'Voice unavailable: ' + event.error + '. Choose another voice in Settings.'; };
    speechSynthesis.resume();
    speechSynthesis.speak(speech);
  }
  let modelMode = 'dynamic';
  loadVoices(); speechSynthesis.addEventListener('voiceschanged', loadVoices);
  const preferencesReady = chrome.storage.local.get(['modelMode', 'voiceURI'])
    .then(saved => { modelMode = saved.modelMode || 'dynamic'; savedVoice = saved.voiceURI || 'browser-default'; })
    .catch(() => { modelMode = 'dynamic'; savedVoice = 'browser-default'; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.modelMode) modelMode = changes.modelMode.newValue || 'dynamic';
    if (changes.voiceURI) { cancelSpeech(); savedVoice = changes.voiceURI.newValue || 'browser-default'; }
  });
  async function act(type, extra) {
    if (busy) return; busy = true; render();
    let failure;
    try { if (type === 'WANDER_START') speak('Starting your tutor.'); await send(type, extra); } catch (error) { failure = error.message; }
    finally { busy = false; render(); scheduleWake(); if (failure) { $('status').textContent = failure; speak(failure); } }
  }
  const isResumeCommand = text => /^(?:please\s+)?(?:resume|continue|keep going|carry on)(?:\s+(?:the\s+)?(?:task|question))?[.!?]*$/i.test(String(text || '').trim());
  async function submit() {
    const task = $('task').value.trim(); if (!task || busy) return;
    if (!selected) state = state ? { ...state, run: null } : state;
    selected = true;
    cancelSpeech();
    const resumable = ['paused', 'waiting'].includes(state?.run?.status);
    const resumeOnly = resumable && isResumeCommand(task);
    await act(resumeOnly || state?.run?.status === 'waiting' ? 'WANDER_RESUME' : 'WANDER_START', resumeOnly ? { answer: '' } : state?.run?.status === 'waiting' ? { answer: task } : { task, modelMode: modelMode });
    if (state?.run?.status === 'running') $('task').value = '';
  }
  $('form').onsubmit = event => { event.preventDefault(); submit(); };
  $('task').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); } };
  // Remember whether the panel is open so it stays open when the learner moves to another page or site.
  // The learner can drag the widget by its button or title row. `desired` is where they put it; it is kept on screen whenever shown.
  const wrap = root.querySelector('.wrap'), head = root.querySelector('.head');
  let desired = null, drag = null, suppressClickUntil = 0;
  function place() {
    if (!desired) return;
    const margin = 8, box = wrap.getBoundingClientRect(), part = ($('card').hidden ? $('orb') : wrap).getBoundingClientRect();
    const dx = part.left - box.left, dy = part.top - box.top;
    const left = Math.round(Math.min(Math.max(desired.left, margin - dx), innerWidth - margin - dx - part.width));
    const top = Math.round(Math.min(Math.max(desired.top, margin - dy), innerHeight - margin - dy - part.height));
    host.style.cssText = `all:initial!important;position:fixed!important;left:${left}px!important;top:${top}px!important;z-index:2147483647!important;display:block!important;`;
  }
  const setPanelOpen = open => { $('card').hidden = !open; place(); chrome.storage.local.set({ panelOpen: open }).catch(() => {}); };
  $('orb').onclick = () => { if (Date.now() < suppressClickUntil) return; setPanelOpen($('card').hidden); };
  $('minimize').onclick = () => setPanelOpen(false);
  const startDrag = event => {
    if (event.button !== 0 || (event.currentTarget === head && event.target.closest('button'))) return;
    const box = wrap.getBoundingClientRect();
    drag = { pointerId: event.pointerId, handle: event.currentTarget, x: event.clientX, y: event.clientY, left: box.left, top: box.top, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.currentTarget === head) event.preventDefault();
  };
  const moveDrag = event => {
    if (event.pointerId !== drag?.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    // Presses that move less than 5 px stay clicks.
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true; wrap.classList.add('dragging');
    desired = { left: drag.left + dx, top: drag.top + dy }; place();
  };
  const endDrag = event => {
    if (event.pointerId !== drag?.pointerId) return;
    if (drag.moved) {
      if (drag.handle === $('orb')) suppressClickUntil = Date.now() + 300;
      chrome.storage.local.set({ widgetPosition: desired }).catch(() => {});
    }
    wrap.classList.remove('dragging'); drag = null;
  };
  for (const handle of [$('orb'), head]) {
    handle.addEventListener('pointerdown', startDrag); handle.addEventListener('pointermove', moveDrag);
    handle.addEventListener('pointerup', endDrag); handle.addEventListener('pointercancel', endDrag);
  }
  addEventListener('resize', place);
  chrome.storage.local.get(['panelOpen', 'widgetPosition']).then(saved => {
    if (saved.panelOpen === true) $('card').hidden = false;
    const position = saved.widgetPosition;
    if (Number.isFinite(position?.left) && Number.isFinite(position?.top)) desired = { left: position.left, top: position.top };
    place();
  }).catch(() => {});
  $('setup').onclick = () => act('WANDER_SETUP'); $('settings').onclick = () => act('WANDER_SETUP');
  $('pause').onclick = () => act('WANDER_PAUSE'); $('resume').onclick = async () => { await act('WANDER_RESUME', { answer: $('task').value.trim() }); if (state?.run?.status === 'running') $('task').value = ''; }; $('stop').onclick = () => act('WANDER_STOP');
  function setWakeListening(value) { wakeListening = value; render(); }
  function clearWakeCommand() {
    awaitingCommand = false; wakeCommand = ''; wakePhraseTail = ''; wakePhraseTailAt = 0; clearTimeout(commandTimer); setWakeListening(false);
  }
  const wakePattern = /\b(?:hello|hey)(?:\s|,)+(?:wander|wonder|wanda)\b[,.!?]?\s*(.*)/i;
  const wakeEchoPattern = /^(?:hello|hey|wander|wonder|wanda|(?:hello|hey)\s+(?:wander|wonder|wanda))[,.!?]*$/i;
  function scheduleWake(delay = awaitingCommand ? 80 : 700) {
    clearTimeout(wakeTimer);
    if (wakeEnabled && !wakeBlocked && !wakeRecognition && !speaking && !listening && !busy && !document.hidden) wakeTimer = setTimeout(startWake, delay);
  }
  function startWake() {
    if (!wakeEnabled || wakeBlocked || wakeRecognition || speaking || listening || document.hidden || busy) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { $('wake').textContent = 'Wake voice unavailable in this browser'; return; }
    const recognizer = new SR(); wakeRecognition = recognizer; let restartDelay;
    recognizer.lang = 'en-US'; recognizer.continuous = !awaitingCommand; recognizer.interimResults = awaitingCommand;
    recognizer.onresult = async event => {
      if (wakeRecognition !== recognizer || speaking || busy) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const words = event.results[i][0].transcript.trim();
        if (!event.results[i].isFinal) {
          if (awaitingCommand) { $('status').textContent = words ? `Listening… ${words}` : 'Listening for your instruction…'; setWakeListening(true); }
          continue;
        }
        const now = Date.now();
        const recentTail = now - wakePhraseTailAt < 2500 ? wakePhraseTail : '';
        const combinedWords = recentTail ? `${recentTail} ${words}` : words;
        const match = combinedWords.match(wakePattern);
        if (match) {
          awaitingCommand = true; wakeCommand = match[1].trim(); wakePhraseTail = ''; wakePhraseTailAt = 0;
          if (wakeEchoPattern.test(wakeCommand)) wakeCommand = '';
          $('status').textContent = 'Listening for your instruction…'; setWakeListening(true);
          clearTimeout(commandTimer);
          commandTimer = setTimeout(() => { clearWakeCommand(); recognizer.abort(); }, 15000);
          if (!wakeCommand) {
            // Chrome commonly ends recognition after the wake phrase. Restart at
            // once in command mode so the user's next sentence is not missed.
            recognizer.abort(); return;
          }
        } else if (awaitingCommand) {
          if (wakeEchoPattern.test(words)) {
            $('status').textContent = 'Listening for your instruction…'; setWakeListening(true);
            recognizer.abort(); return;
          }
          wakeCommand = words;
        } else {
          // Chrome can split the wake phrase into separate final results, such as
          // “Hello” followed by “Wander”. Keep only a short rolling tail.
          wakePhraseTail = words.split(/\s+/).slice(-3).join(' '); wakePhraseTailAt = now;
        }
        if (awaitingCommand && wakeCommand) {
          const task = wakeCommand; clearWakeCommand(); recognizer.abort();
          if (selected && ['paused', 'waiting'].includes(state?.run?.status) && isResumeCommand(task)) {
            $('task').value = '';
            await act('WANDER_RESUME', { answer: '' }); scheduleWake(); return;
          }
          if (selected && state?.run?.status === 'running') { await act('WANDER_PAUSE'); if (state?.run?.status === 'running') return; }
          $('task').value = task; await submit(); scheduleWake(); return;
        }
      }
    };
    recognizer.onerror = event => {
      if (['not-allowed', 'service-not-allowed'].includes(event.error)) {
        wakeBlocked = true; clearWakeCommand(); $('wake').textContent = 'Enable microphone for “Hello Wander”'; $('status').textContent = document.featurePolicy?.allowsFeature("microphone") === false ? 'This website blocks microphone use, so “Hello Wander” can’t listen here. Type your task instead.' : 'Allow microphone access, then enable Hello Wander again.';
      } else if (event.error === 'audio-capture') {
        restartDelay = 1200;
        $('status').textContent = 'The microphone is busy. Still listening for your instruction…';
      }
    };
    recognizer.onend = () => {
      if (wakeRecognition === recognizer) wakeRecognition = null;
      if (awaitingCommand) { setWakeListening(true); $('status').textContent = 'Listening for your instruction…'; }
      scheduleWake(restartDelay);
    };
    try { recognizer.start(); } catch { if (wakeRecognition === recognizer) wakeRecognition = null; scheduleWake(700); }
  }
  $('wake').onclick = async () => {
    wakeEnabled = wakeBlocked || !wakeEnabled; wakeBlocked = false;
    await chrome.storage.local.set({ wakeEnabled });
    $('wake').textContent = wakeEnabled ? 'Hello Wander on · click to turn off' : 'Enable “Hello Wander”';
    clearTimeout(wakeTimer); wakeRecognition?.abort();
    if (wakeEnabled) { cancelSpeech(); setTimeout(startWake, 0); }
    else clearWakeCommand();
  };
  chrome.storage.local.get(['wakeEnabled', 'wakeSites']).then(saved => {
    wakeEnabled = saved.wakeEnabled === true || saved.wakeSites?.[location.origin] === true;
    if (!wakeEnabled) return;
    $('wake').textContent = 'Hello Wander on · click to turn off';
    if (saved.wakeEnabled !== true) chrome.storage.local.set({ wakeEnabled: true });
    scheduleWake();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(wakeTimer); wakeRecognition?.abort(); } else scheduleWake(); });
  $('mic').onclick = async () => {
    clearTimeout(wakeTimer);
    const wasListening = listening; listening = true; wakeRecognition?.abort();
    if (selected && state?.run?.status === 'running') { await act('WANDER_PAUSE'); if (state?.run?.status === 'running') { listening = false; scheduleWake(); return; } }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { listening = false; $('status').textContent = 'Speech is unavailable here. Type your instruction instead.'; return; }
    if (wasListening) { recognition?.stop(); return; }
    recognition = new SR(); recognition.lang = 'en-CA'; recognition.interimResults = true; recognition.continuous = false; transcript = '';
    recognition.onstart = () => { listening = true; $('micLabel').textContent = 'Listening…'; $('mic').classList.add('live'); $('status').textContent = 'I’m listening. Say what you need.'; render(); };
    recognition.onresult = event => { transcript = Array.from(event.results).map(r => r[0].transcript).join(' '); $('task').value = transcript; };
    recognition.onerror = event => { transcript = ''; $('status').textContent = event.error === 'not-allowed' ? (document.featurePolicy?.allowsFeature("microphone") === false ? 'This website blocks microphone use. Type your task instead.' : 'Allow microphone access for this page, or type your task.') : 'Speech recognition was unavailable. You can type your task.'; };
    recognition.onend = () => { listening = false; $('micLabel').textContent = 'Talk to Wander'; $('mic').classList.remove('live'); render(); if (transcript.trim()) submit(); else scheduleWake(); };
    try { cancelSpeech(); recognition.start(); } catch { listening = false; scheduleWake(); $('status').textContent = 'Could not start speech. Type your instruction instead.'; }
  };
  chrome.runtime.onMessage.addListener(message => { if (message.type === 'WANDER_STATE') { if (message.state) { selected = true; state = message.state; render(); } if (message.error) { $('status').textContent = message.error; if (!listening && !wakeListening && message.error !== 'Preparing your tutor…') speak(message.error); } } });
  async function refresh() {
    if (!host.isConnected) return;
    try { const response = await send('WANDER_STATUS'); paired = response.paired !== false; selected = response.selected !== false; render(); }
    catch (error) { $('status').textContent = error.message; }
  }
  refresh();
  // Messages also keep the service worker alive while a remote model step is pending.
  const interval = setInterval(refresh, 8000);
  window.addEventListener('pagehide', () => { clearInterval(interval); clearTimeout(wakeTimer); clearTimeout(commandTimer); wakeRecognition?.abort(); cancelSpeech(); transcript = ''; recognition?.abort(); });
})();
