// Renders the README screenshots from the real extension UI against a local fixture page.
// Usage (from the repository root): node docs/assets/capture.mjs
// No API keys, extension install, or network access are required.
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { snapshotPage } from '../../extension/page-tools.js';
import { showGuidance } from '../../extension/guidance.js';

const out = path.resolve('docs/assets');
const candidates = [process.env.TEST_CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].filter(Boolean);
const executablePath = candidates.find(candidate => fs.existsSync(candidate));
if (!executablePath) throw new Error('Set TEST_CHROME_PATH to a Google Chrome executable.');

const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>Public Services</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f6f7f8;color:#26323f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}
  header{background:#fff;border-bottom:1px solid #d7dce1}.utility{height:34px;background:#26374a;color:white;padding:8px 54px;font-size:12px}.main{height:90px;display:flex;align-items:center;padding:0 54px;gap:38px}.flag{font-size:26px;font-weight:700;color:#c52836;letter-spacing:-.02em}.search{display:flex;flex:1;max-width:560px}.search input{flex:1;padding:15px;border:1px solid #87929d;font-size:15px}.search button{padding:0 24px;background:#26374a;color:#fff;border:0;font-weight:700}
  nav{background:#e8ecef;padding:0 48px;display:flex;border-bottom:1px solid #ccd2d8}nav button{padding:17px 20px;border:0;border-right:1px solid #ccd2d8;background:transparent;color:#26374a;font:inherit}.crumb{padding:24px 60px 0;color:#546b7f;font-size:13px}.layout{display:grid;grid-template-columns:250px 1fr 300px;gap:30px;padding:25px 60px}.side,.notice{background:white;border:1px solid #dce1e5;padding:22px}.side h3,.notice h3{margin-top:0}.side a{display:block;padding:13px 0;border-bottom:1px solid #e7eaed;color:#315c86}.content{background:white;padding:30px;border:1px solid #dce1e5}.content h1{font-size:38px;margin:0 0 12px;letter-spacing:-.02em}.lead{font-size:18px;line-height:1.55}.tiles{display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-top:24px}.tile{padding:20px;border:1px solid #c9d1d8;background:#fbfcfd}.tile b{display:block;color:#315c86;margin-bottom:7px}.notice{height:max-content}.notice button{width:100%;padding:12px;margin-top:8px;font:inherit}.fine{font-size:12px;color:#71808c;line-height:1.6}
</style></head><body>
  <header><div class="utility">English &nbsp; | &nbsp; Français &nbsp;&nbsp;&nbsp; Sign in &nbsp; Help &nbsp; Contact</div><div class="main"><div class="flag">PUBLIC SERVICES</div><div class="search"><input id="searchInput" placeholder="Search programs and services"><button id="searchButton">Search</button></div></div></header>
  <nav><button>Benefits</button><button>Travel</button><button>Taxes</button><button>Jobs</button><button>Immigration</button><button>Health</button><button>More services ▾</button></nav>
  <div class="crumb">Home › Services › Documents and identification</div><main class="layout"><aside class="side"><h3>Most requested</h3><a>Find a service office</a><a>Check processing times</a><a>Application status</a><a>Forms and guides</a><a>Contact a department</a></aside><section class="content"><h1>Documents and identification</h1><p class="lead">Find information about passports, identity documents, applications, fees, processing times, and service locations.</p><div class="tiles"><div class="tile"><b>Apply for a passport</b><span>New applications and renewals</span></div><div class="tile"><b>Replace a document</b><span>Lost, stolen, or damaged documents</span></div><div class="tile"><b>Forms and supporting documents</b><span>Choose the correct application</span></div><div class="tile"><b>Processing and service standards</b><span>Current wait times and updates</span></div></div></section><aside class="notice"><h3>Before you begin</h3><p>Choose an application type and review the documents you need.</p><button>Start an application</button><button>Sign in to your account</button><p class="fine">Some services open in a different portal. Fees and requirements vary.</p></aside></main>
</body></html>`;

// Serve the fixture and the local workspace UI without touching a real session or any keys.
const publicDir = path.resolve('public');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/fixture') return res.writeHead(200, { 'content-type': 'text/html' }).end(fixture);
  if (url.pathname === '/api/state') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ configured: false, keys: { openai: false, steel: false, elevenlabs: false }, budget: { spent: 0, limit: 1.8, calls: 0, runLimit: .08, model: 'gpt-5.6-luna' }, session: null, connecting: false, run: null, logs: [] }));
  const file = path.join(publicDir, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(publicDir) || !fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));

  const stubChrome = state => page.evaluate(state => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) { return attach.call(this, { ...options, mode: 'open' }); };
    window.chrome = {
      storage: { local: { get: async () => ({ modelMode: 'dynamic' }), set: async () => {} }, onChanged: { addListener() {} } },
      runtime: { sendMessage: async () => ({ paired: true, selected: true, state }), onMessage: { addListener() {} } }
    };
  }, state);
  const shadow = (id, fn) => page.evaluate(([id, fn]) => new Function('el', fn)(document.querySelector('#wander-widget').shadowRoot.getElementById(id)), [id, fn]);

  // 1. Panel open, before any question is asked.
  await page.goto(`${origin}/fixture`);
  await stubChrome({ budget: { spent: 0 }, practice: null, run: null });
  await page.addScriptTag({ path: path.resolve('extension/overlay.js') });
  await shadow('orb', 'el.click()');
  await shadow('task', 'el.value = "Show me how to renew my passport."');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'screenshot-panel.png') });

  // 2. A live step: Wander highlights one control and explains it.
  await page.goto(`${origin}/fixture`);
  await stubChrome({
    budget: { spent: .012 },
    practice: { phase: 'observed', exploredPages: 3, learnedRoutes: 2, rehearsed: true },
    run: { id: 'readme', tutor: true, mode: 'local', status: 'running', phase: 'your-turn', message: 'Start with the site search. Type “renew adult passport”.', model: 'gpt-5.6-luna' }
  });
  await page.addScriptTag({ path: path.resolve('extension/overlay.js') });
  const observation = await page.evaluate(snapshotPage);
  const target = observation.elements.find(element => element.label?.includes('Search programs'))?.id;
  await page.evaluate(showGuidance, {
    action: { id: 'readme-step', action: 'fill', target, value: 'renew adult passport', message: 'Type “renew adult passport” in the site search, then press Enter.' },
    observation,
    runId: 'readme'
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'screenshot-guidance.png') });
  await page.screenshot({ path: path.join(out, 'screenshot-guidance-crop.png'), clip: { x: 250, y: 20, width: 640, height: 380 } });

  // 3. The local workspace and settings.
  await page.goto(`${origin}/`);
  await page.locator('.wordmark').waitFor();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(out, 'screenshot-workspace.png') });
  await page.locator('#settingsButton').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'screenshot-settings.png') });

  if (errors.length) throw new Error(`Page errors: ${errors.join('\n')}`);
  console.log(`Wrote screenshots to ${out}`);
} finally {
  await browser.close();
  server.close();
}
