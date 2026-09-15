let audio = null, reader = null, mediaUrl = '', generation = 0;

function cancel() {
  generation++;
  reader?.cancel().catch(() => {}); reader = null;
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio = null; }
  if (mediaUrl) { URL.revokeObjectURL(mediaUrl); mediaUrl = ''; }
}

async function play(text, token) {
  cancel(); const current = generation;
  const response = await fetch('http://127.0.0.1:4318/api/local/speech', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  if (!response.ok || !response.body) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'ElevenLabs voice request failed.'); }
  if (current !== generation) { await response.body.cancel().catch(() => {}); return; }
  if (!MediaSource.isTypeSupported('audio/mpeg')) {
    const blob = await response.blob(); if (current !== generation) return;
    const url = URL.createObjectURL(blob), currentAudio = new Audio(url); mediaUrl = url; audio = currentAudio;
    await currentAudio.play(); await new Promise((resolve, reject) => { currentAudio.onended = resolve; currentAudio.onerror = () => reject(new Error('ElevenLabs audio could not be played.')); });
    if (current === generation) cancel(); return;
  }
  const mediaSource = new MediaSource(), url = URL.createObjectURL(mediaSource), currentAudio = new Audio(url); mediaUrl = url; audio = currentAudio;
  const sourceBuffer = await new Promise((resolve, reject) => {
    mediaSource.addEventListener('sourceopen', () => { try { resolve(mediaSource.addSourceBuffer('audio/mpeg')); } catch (error) { reject(error); } }, { once: true });
    currentAudio.play().catch(() => {});
  });
  if (current !== generation) { currentAudio.pause(); await response.body.cancel().catch(() => {}); return; }
  reader = response.body.getReader(); let started = false;
  while (current === generation) {
    const { done, value } = await reader.read();
    if (done) { reader = null; if (mediaSource.readyState === 'open') mediaSource.endOfStream(); break; }
    if (current !== generation) return;
    await new Promise((resolve, reject) => { sourceBuffer.addEventListener('updateend', resolve, { once: true }); sourceBuffer.addEventListener('error', reject, { once: true }); sourceBuffer.appendBuffer(value); });
    if (current !== generation) return;
    if (!started) { started = true; await currentAudio.play(); }
  }
  if (current !== generation) return;
  await new Promise((resolve, reject) => { currentAudio.onended = resolve; currentAudio.onerror = () => reject(new Error('ElevenLabs audio could not be played.')); });
  if (current === generation) cancel();
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message.target !== 'wander-offscreen') return;
  if (message.type === 'CANCEL_SPEECH') { cancel(); reply({ ok: true }); return; }
  if (message.type === 'PLAY_SPEECH') {
    play(message.text, message.token).then(() => reply({ ok: true }), error => reply({ error: error?.message || 'ElevenLabs voice failed.' }));
    return true;
  }
});
