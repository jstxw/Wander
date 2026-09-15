import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const executablePath = [
  process.env.TEST_CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
].filter(Boolean).find(fs.existsSync);
if (!executablePath) throw new Error('Google Chrome was not found.');

const videoPath = path.resolve('artifacts/wander-promo/wander-promo.mp4');
const videoUrl = `file:///${videoPath.replaceAll('\\','/')}`;
const frameDirectory = path.resolve('artifacts/wander-promo/qa-frames');
fs.mkdirSync(frameDirectory, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required','--allow-file-access-from-files'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(videoUrl, { waitUntil:'commit' });
  const video = page.locator('video').first();
  await video.waitFor({ state:'attached' });
  await video.evaluate(element => new Promise((resolve,reject) => { if (element.readyState >= 1) resolve(); else { element.onloadedmetadata=resolve; element.onerror=()=>reject(new Error(element.error?.message || 'Video failed to load')); } }));
  const metadata = await video.evaluate(element => ({ duration:element.duration, width:element.videoWidth, height:element.videoHeight }));
  await page.evaluate(() => { const canvas=document.createElement('canvas');canvas.id='qaCanvas';canvas.width=1280;canvas.height=720;document.body.append(canvas); });
  const qaCanvas = page.locator('#qaCanvas');
  await video.evaluate(async element => { element.muted=true;element.playbackRate=8;await element.play(); });
  for (const second of [4,20,30,55,68,79,87]) {
    await page.waitForFunction(time => document.querySelector('video').currentTime >= time, second, { timeout:30000 });
    await page.evaluate(() => document.querySelector('#qaCanvas').getContext('2d').drawImage(document.querySelector('video'),0,0,1280,720));
    await qaCanvas.screenshot({ path:path.join(frameDirectory, `frame-${String(second).padStart(2,'0')}.png`) });
  }
  await page.goto(`file:///${path.resolve('promo/video.html').replaceAll('\\','/')}`);
  const audioStats = await page.evaluate(async () => {
    const bytes = await fetch('../artifacts/wander-promo/wander-promo.mp4').then(response => response.arrayBuffer());
    const context = new AudioContext();const audio = await context.decodeAudioData(bytes);const samples = audio.getChannelData(0);let peak=0;
    for(let index=0;index<samples.length;index+=100) peak=Math.max(peak,Math.abs(samples[index]));
    const duration=audio.duration;await context.close();return {peak,duration};
  });
  if (Math.abs(audioStats.duration-90) > .6 || metadata.width !== 1280 || metadata.height !== 720 || audioStats.peak < .005) throw new Error(`QA failed: ${JSON.stringify({metadata,audioStats})}`);
  console.log(JSON.stringify({ metadata, audioStats, frameDirectory }));
} finally {
  await browser.close();
}
