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
    :host{color-scheme:light}*{box-sizing:border-box}button,input,textarea{font:inherit}button{cursor:pointer;border:0}button:disabled{opacity:.5;cursor:wait}[hidden]{display:none!important}.wrap{font:12px 'Overpass',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f3a33;width:310px;display:flex;align-items:flex-end;flex-direction:column;gap:10px;max-width:calc(100vw - 32px)}.orb-button{width:60px;height:60px;border-radius:18px;padding:0;background:#1f3a33;box-shadow:0 0 0 3px #fff,0 6px 22px #1f3a3355;position:relative;display:grid;place-items:center}.orb-button:after{content:'';position:absolute;inset:-10px;border-radius:50%;background:repeating-radial-gradient(ellipse at 35% 25%,transparent 0 3px,#ffffff66 3.5px 4px,transparent 4.5px 6px);opacity:.55;animation:drift 8s ease-in-out infinite}.orb-button.working{animation:pulse 1.8s ease-in-out infinite}.orb-button.listening{animation:pulse .9s ease-in-out infinite;box-shadow:0 0 0 3px #fff,0 0 0 7px #3d7ea6}.card{width:100%;border:1px solid #cfdad2;border-radius:12px;background:#fbfcfaf7;box-shadow:0 16px 65px #253f3526,0 2px 8px #253f350a;backdrop-filter:blur(22px);overflow:hidden}.head{padding:16px 17px 12px;display:flex;align-items:center;gap:8px}.brand{font-size:18px;font-weight:800;letter-spacing:-.4px;display:flex;align-items:center;gap:7px}.brand svg{width:20px;height:20px}.steel{font-size:10px;color:#3e6b5a;border:1px solid #cfdad2;border-radius:4px;padding:3px 5px 2px;margin-left:2px}.minimize{margin-left:auto;background:none;color:#9ba8a3;font-size:20px;padding:0 4px}.body{padding:0 17px 16px}.subtitle{font-size:11px;color:#96a7a1;line-height:1.7;margin:0 0 12px}.status{font-size:10px;line-height:1.65;background:#f1f8f5;color:#7c9b90;border-radius:8px;padding:9px 11px;max-height:120px;overflow:auto;white-space:pre-wrap;margin-bottom:12px}.task{display:flex;gap:6px;border:1px solid #dfebe6;border-radius:9px;background:white;padding:6px}.task textarea{resize:none;width:100%;min-width:0;border:0;outline:0;padding:6px;line-height:1.5;font-size:11px;color:#485953;background:transparent}.task textarea::placeholder{color:#a5b6b0}.send{align-self:flex-end;background:#e7f4ef;color:#7da798;border-radius:6px;width:28px;height:28px;flex-shrink:0;font-size:19px}.actions{display:flex;gap:7px;margin-top:10px}.mic{background:#1f3a33;color:white;border-radius:8px;padding:10px 12px;flex:1;font-size:11px}.secondary{border:1px solid #e0ece7;background:transparent;color:#7d998f;border-radius:8px;padding:9px;font-size:10px}.setup{width:100%;background:#3e6b5a;color:white;border-radius:8px;padding:11px;margin-bottom:10px;font-size:11px}.footer{display:flex;justify-content:space-between;align-items:center;border-top:1px solid #e9f0ed;padding:10px 17px;color:#99aca5;font-size:9px}.footer button{background:none;font-size:9px;color:#8ba69c;padding:0}.caption{font-size:9px;color:#a2b7af;margin-top:10px}.mic.live{background:#3d7ea6}select{border:1px solid #dfebe6;border-radius:6px;background:#fff;color:#5c7f72;padding:5px;font-size:10px}.orb-button.speaking{animation:voicePulse .65s ease-in-out infinite;box-shadow:0 0 0 3px #fff,0 0 0 7px #f2b233,0 0 30px #f2b23388}@keyframes voicePulse{0%,100%{transform:scale(1)}35%{transform:scale(1.09) rotate(2deg)}65%{transform:scale(1.04) rotate(-2deg)}}button:focus-visible{outline:2px solid #1f3a33;outline-offset:3px;box-shadow:0 0 0 5px #f2b23366}@keyframes pulse{50%{transform:scale(1.06)}}@keyframes drift{50%{transform:rotate(35deg) scale(1.12)}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}
.orb-button:after{display:none}.blaze{width:36px;height:36px;display:block}.blaze rect{fill:#f2b233;transform-box:fill-box}.orb-button.working .b1{animation:hop 1.1s ease-in-out infinite}.orb-button.working .b2{animation:hop 1.1s ease-in-out -.55s infinite}@keyframes hop{50%{transform:translateY(-3px)}}
  </style><div class="wrap"><button class="orb-button" id="orb" aria-label="Open Wander chat" title="Wander · click to open"><svg class="blaze" viewBox="0 0 32 32" aria-hidden="true"><rect class="b1" x="16.5" y="4" width="7" height="11" rx="1.5"/><rect class="b2" x="8.5" y="17" width="7" height="11" rx="1.5"/></svg></button><section class="card" id="card" hidden><div class="head"><span class="brand"><svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#1f3a33"/><rect x="16" y="6" width="6" height="9" rx="1.5" fill="#f2b233"/><rect x="10" y="17" width="6" height="9" rx="1.5" fill="#f2b233"/></svg>Wander</span><span class="steel">Steel Computer</span><button class="minimize" id="minimize" aria-label="Minimize chat">−</button></div><div class="body"><p class="subtitle">Your tab. Your voice. A little less clicking.</p><div class="status" id="status" role="status">What would you like to do on the web?</div><button class="setup" id="setup" hidden>Connect Wander ↗</button><form class="task" id="form"><textarea id="task" rows="2" maxlength="1500" placeholder="Find school supplies, compare prices…" aria-label="Your instruction"></textarea><button class="send" id="send" type="submit" aria-label="Send instruction">↑</button></form><div class="actions"><button class="mic" id="mic">◉ &nbsp; Talk to Wander</button><button class="secondary" id="pause" hidden>Pause</button><button class="secondary" id="resume" hidden>Resume</button><button class="secondary" id="stop" hidden>Stop</button></div><button class="secondary" id="wake" style="width:100%;margin-top:10px">Enable “Hello Wander”</button><div class="caption" id="caption">Send = new task · Resume = continue</div></div><div class="footer"><span id="budget">Luna · $1.80 budget</span><button id="settings">Settings ↗</button></div></section></div>`;
  document.documentElement.append(host);
  const $ = id => root.getElementById(id);
  root.querySelector('.subtitle').textContent = 'Learn the web, one highlighted step at a time.';
  $('task').placeholder = 'Show me how to use this website…';
  const practicePanel = document.createElement('div');
  practicePanel.style.cssText = 'margin:10px 0;padding:11px;background:#f3faf7;border:1px solid #dfece7;border-radius:10px;color:#68877c;font-size:11px;line-height:1.6';
  practicePanel.innerHTML = '<div id="practicePhase">✧ Wander explores. You learn.</div><div id="practiceDetail" style="margin-top:4px;color:#869b93">Your clicks stay yours.</div>';
  $('status').after(practicePanel);
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
    if (working) $('caption').textContent = run.phase === 'your-turn' ? 'Your turn: follow the yellow marker' : 'Wander is checking the website in its own browser';
    else $('caption').textContent = 'Ask for a task · learn by doing';
    const practice = state?.practice;
    $('practicePhase').textContent = run?.phase === 'exploring' ? '✧ Exploring on Steel Computer…' : practice?.rehearsed ? '✓ Navigation rehearsed in Steel Browser' : practice?.phase === 'local-observation' ? '◉ Guidance from your current page' : practice ? '◉ Public page inspected in Steel Browser' : '✧ Wander explores. You learn.';
    $('practiceDetail').textContent = practice?.limitation || (practice ? `${practice.exploredPages || 0} pages explored · ${practice.learnedRoutes || 0} routes learned · evidence saved` : 'Your clicks stay yours.');
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
    try { if (type === 'WANDER_START') speak('Starting Steel Computer.'); await send(type, extra); } catch (error) { failure = error.message; }
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
  $('orb').onclick = () => $('card').hidden = !$('card').hidden;
  $('minimize').onclick = () => $('card').hidden = true;
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
        wakeBlocked = true; clearWakeCommand(); $('wake').textContent = 'Enable microphone for “Hello Wander”'; $('status').textContent = 'Allow microphone access, then enable Hello Wander again.';
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
    $('wake').textContent = wakeEnabled ? '● Hello Wander on · click to disable' : 'Enable “Hello Wander”';
    clearTimeout(wakeTimer); wakeRecognition?.abort();
    if (wakeEnabled) { cancelSpeech(); setTimeout(startWake, 0); }
    else clearWakeCommand();
  };
  chrome.storage.local.get(['wakeEnabled', 'wakeSites']).then(saved => {
    wakeEnabled = saved.wakeEnabled === true || saved.wakeSites?.[location.origin] === true;
    if (!wakeEnabled) return;
    $('wake').textContent = '● Hello Wander on · click to disable';
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
    recognition.onstart = () => { listening = true; $('mic').textContent = '◉  Listening…'; $('mic').classList.add('live'); $('status').textContent = 'I’m listening. Say what you need.'; render(); };
    recognition.onresult = event => { transcript = Array.from(event.results).map(r => r[0].transcript).join(' '); $('task').value = transcript; };
    recognition.onerror = event => { transcript = ''; $('status').textContent = event.error === 'not-allowed' ? 'Allow microphone access for this page, or type your task.' : 'Speech recognition was unavailable. You can type your task.'; };
    recognition.onend = () => { listening = false; $('mic').textContent = '◉  Talk to Wander'; $('mic').classList.remove('live'); render(); if (transcript.trim()) submit(); else scheduleWake(); };
    try { cancelSpeech(); recognition.start(); } catch { listening = false; scheduleWake(); $('status').textContent = 'Could not start speech. Type your instruction instead.'; }
  };
  chrome.runtime.onMessage.addListener(message => { if (message.type === 'WANDER_STATE') { if (message.state) { selected = true; state = message.state; render(); } if (message.error) { $('status').textContent = message.error; if (!listening && !wakeListening && message.error !== 'Starting your agent on Steel Computer…') speak(message.error); } } });
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
