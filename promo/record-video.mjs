import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const executablePath = [
  process.env.TEST_CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
].filter(Boolean).find(fs.existsSync);
if (!executablePath) throw new Error('Google Chrome was not found.');

const outputDirectory = path.resolve('artifacts/wander-promo');
fs.mkdirSync(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, 'wander-promo.webm');
const browser = await chromium.launch({ executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', message => console.log(message.text()));
  await page.goto(`file:///${path.resolve('promo/video.html').replaceAll('\\','/')}`);
  await page.waitForFunction(() => typeof window.renderWanderPromo === 'function');
  const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
  const result = await page.evaluate(async () => {
    const recording = await window.renderWanderPromo();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(recording.blob);
    link.download = 'wander-promo.webm';
    link.click();
    return { mimeType:recording.mimeType, duration:recording.duration, bytes:recording.blob.size };
  });
  const download = await downloadPromise;
  await download.saveAs(outputPath);
  console.log(JSON.stringify({ outputPath, bytes:fs.statSync(outputPath).size, duration:result.duration, mimeType:result.mimeType }));
} finally {
  await browser.close();
}
