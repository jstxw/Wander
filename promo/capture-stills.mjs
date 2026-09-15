import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { snapshotPage } from '../extension/page-tools.js';
import { showGuidance } from '../extension/guidance.js';

const output = path.resolve('artifacts/wander-promo');
fs.mkdirSync(output, { recursive: true });
const executablePath = [
  process.env.TEST_CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
].filter(Boolean).find(fs.existsSync);
if (!executablePath) throw new Error('Google Chrome was not found.');

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
try {
  await page.setContent(`<!doctype html><html><head><style>
    *{box-sizing:border-box}body{margin:0;background:#f6f7f8;color:#26323f;font-family:Arial,sans-serif}
    header{background:#fff;border-bottom:1px solid #d7dce1}.utility{height:34px;background:#26374a;color:white;padding:8px 54px;font-size:12px}.main{height:90px;display:flex;align-items:center;padding:0 54px;gap:38px}.flag{font-size:29px;font-weight:700;color:#c52836}.search{display:flex;flex:1;max-width:560px}.search input{flex:1;padding:15px;border:1px solid #87929d;font-size:15px}.search button{padding:0 24px;background:#26374a;color:#fff;border:0;font-weight:700}
    nav{background:#e8ecef;padding:0 48px;display:flex;gap:0;border-bottom:1px solid #ccd2d8}nav button{padding:17px 20px;border:0;border-right:1px solid #ccd2d8;background:transparent;color:#26374a}.crumb{padding:24px 60px 0;color:#546b7f;font-size:13px}.layout{display:grid;grid-template-columns:250px 1fr 300px;gap:30px;padding:25px 60px}.side,.notice{background:white;border:1px solid #dce1e5;padding:22px}.side h3,.notice h3{margin-top:0}.side a{display:block;padding:13px 0;border-bottom:1px solid #e7eaed;color:#315c86}.content{background:white;padding:30px;border:1px solid #dce1e5}.content h1{font-size:38px;margin:0 0 12px}.lead{font-size:18px;line-height:1.55}.tiles{display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-top:24px}.tile{padding:20px;border:1px solid #c9d1d8;background:#fbfcfd}.tile b{display:block;color:#315c86;margin-bottom:7px}.notice{height:max-content}.notice button{width:100%;padding:12px;margin-top:8px}.fine{font-size:12px;color:#71808c;line-height:1.6}
  </style></head><body>
    <header><div class="utility">English &nbsp; | &nbsp; Français &nbsp;&nbsp;&nbsp; Sign in &nbsp; Help &nbsp; Contact</div><div class="main"><div class="flag">PUBLIC SERVICES</div><div class="search"><input id="searchInput" placeholder="Search programs and services"><button id="searchButton">Search</button></div></div></header>
    <nav><button>Benefits</button><button>Travel</button><button>Taxes</button><button>Jobs</button><button>Immigration</button><button>Health</button><button>More services ▾</button></nav>
    <div class="crumb">Home › Services › Documents and identification</div><main class="layout"><aside class="side"><h3>Most requested</h3><a>Find a service office</a><a>Check processing times</a><a>Application status</a><a>Forms and guides</a><a>Contact a department</a></aside><section class="content"><h1>Documents and identification</h1><p class="lead">Find information about passports, identity documents, applications, fees, processing times, and service locations.</p><div class="tiles"><div class="tile"><b>Apply for a passport</b><span>New applications and renewals</span></div><div class="tile"><b>Replace a document</b><span>Lost, stolen, or damaged documents</span></div><div class="tile"><b>Forms and supporting documents</b><span>Choose the correct application</span></div><div class="tile"><b>Processing and service standards</b><span>Current wait times and updates</span></div></div></section><aside class="notice"><h3>Before you begin</h3><p>Choose an application type and review the documents you need.</p><button>Start an application</button><button>Sign in to your account</button><p class="fine">Some services open in a different portal. Fees and requirements vary.</p></aside></main>
  </body></html>`);

  await page.evaluate(() => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) { return attach.call(this, { ...options, mode: 'open' }); };
    const state = {
      budget: { spent: .012 },
      practice: { phase: 'observed', exploredPages: 3, learnedRoutes: 2, rehearsed: true },
      run: { id: 'promo', tutor: true, mode: 'local', status: 'running', phase: 'your-turn', message: 'Start with the site search. Type “renew adult passport”.', model: 'gpt-5.6-luna' }
    };
    window.chrome = {
      storage: { local: { get: async () => ({ modelMode: 'dynamic' }), set: async () => {} }, onChanged: { addListener() {} } },
      runtime: { sendMessage: async () => ({ paired: true, selected: true, state }), onMessage: { addListener() {} } }
    };
  });
  await page.addScriptTag({ path: path.resolve('extension/overlay.js') });
  await page.evaluate(() => document.querySelector('#wander-widget').shadowRoot.getElementById('orb').click());
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(output, 'wander-on-public-services.png') });

  const observation = await page.evaluate(snapshotPage);
  const target = observation.elements.find(element => element.label?.includes('Search programs'))?.id;
  await page.evaluate(showGuidance, {
    action: { id: 'promo-step', action: 'fill', target, value: 'renew adult passport', message: 'Type “renew adult passport”, then press Enter.' },
    observation,
    runId: 'promo'
  });
  await page.screenshot({ path: path.join(output, 'wander-highlight.png') });
} finally {
  await browser.close();
}

console.log(output);
