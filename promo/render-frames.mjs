import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const fps = 15;
const duration = 90;
const executablePath = [
  process.env.TEST_CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
].filter(Boolean).find(fs.existsSync);
if (!executablePath) throw new Error('Google Chrome was not found.');

const outputRoot = path.resolve('artifacts/wander-promo');
const frameDirectory = path.resolve(outputRoot, 'frames');
if (!frameDirectory.startsWith(outputRoot + path.sep)) throw new Error('Unsafe frame directory.');
fs.rmSync(frameDirectory, { recursive:true, force:true });
fs.mkdirSync(frameDirectory, { recursive:true });

const browser = await chromium.launch({ executablePath, headless:true });
try {
  const page = await browser.newPage({ viewport:{ width:1280, height:720 }, deviceScaleFactor:1 });
  await page.goto(`file:///${path.resolve('promo/video.html').replaceAll('\\','/')}`);
  await page.waitForFunction(() => typeof window.wanderRenderFrame === 'function');
  const stage = page.locator('#stage');
  const frameCount = fps * duration;
  for(let frame=0;frame<frameCount;frame++) {
    await page.evaluate(time => window.wanderRenderFrame(time), frame/fps);
    await stage.screenshot({ path:path.join(frameDirectory, `frame-${String(frame).padStart(4,'0')}.jpg`), type:'jpeg', quality:92 });
    if(frame % (fps*10) === 0) console.log(`Rendered ${Math.round(frame/fps)}s / ${duration}s`);
  }
  console.log(JSON.stringify({ frameDirectory, frameCount, fps, duration }));
} finally {
  await browser.close();
}
