// Downloads a standalone CPython 3.12 build for this machine into vendor/python/<platform>-<arch>
// and installs the tutor's Python dependencies into it, so Wander never needs a system Python.
// Run it on the platform you are packaging for: the Playwright wheel contains platform binaries.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RELEASE = '20261026';
const VERSION = '3.12.16';
const PLAYWRIGHT = '1.58.0';
// SHA-256 values from the release's SHA256SUMS file.
const BUILDS = {
  'darwin-arm64': ['aarch64-apple-darwin', 'fbf4afef53c2a6b72bb741bc06d5671a9dfaf87bd84e5aa73ac9b3d0d589f14e'],
  'darwin-x64': ['x86_64-apple-darwin', 'a962e47df522889eaa7ff0d6a56203f1079f68aabb65ffdbe8455f362bc769f3'],
  'win32-x64': ['x86_64-pc-windows-msvc', '590dfcbe3a34c07301e6332e13e2188b98655cd072b08afa45a7998dc4c22bc5'],
  'linux-x64': ['x86_64-unknown-linux-gnu', '6a79e922e50006b601f29e688407659da1c2b86ebcd4e9c7254cf234be8b89de']
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = `${process.platform}-${process.arch}`;
const build = BUILDS[platform];
if (!build) throw new Error(`No bundled Python build is configured for ${platform}.`);
const [triple, sha256] = build;
const target = path.join(root, 'vendor', 'python', platform);
const python = process.platform === 'win32' ? path.join(target, 'python.exe') : path.join(target, 'bin', 'python3');
const stamp = path.join(target, '.wander-bundle.json');
const wanted = { python: VERSION, release: RELEASE, playwright: PLAYWRIGHT };

if (fs.existsSync(stamp) && JSON.stringify(JSON.parse(fs.readFileSync(stamp, 'utf8'))) === JSON.stringify(wanted)) {
  console.log(`Python ${VERSION} with Playwright ${PLAYWRIGHT} is already bundled at ${path.relative(root, target)}.`);
  process.exit(0);
}

const name = `cpython-${VERSION}+${RELEASE}-${triple}-install_only.tar.gz`;
const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE}/${encodeURIComponent(name)}`;
console.log(`Downloading ${name}…`);
const response = await fetch(url);
if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}: ${url}`);
const archive = Buffer.from(await response.arrayBuffer());
const actual = createHash('sha256').update(archive).digest('hex');
if (actual !== sha256) throw new Error(`Checksum mismatch for ${name}: expected ${sha256}, got ${actual}.`);

const staging = path.join(root, 'vendor', 'python', `.staging-${platform}`);
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });
const tarball = path.join(staging, name);
fs.writeFileSync(tarball, archive);
// bsdtar ships with macOS and Windows 10+; GNU tar on Linux. The archive holds a single python/ folder.
execFileSync('tar', ['-xzf', name], { cwd: staging, stdio: 'inherit' });
fs.rmSync(target, { recursive: true, force: true });
fs.renameSync(path.join(staging, 'python'), target);
fs.rmSync(staging, { recursive: true, force: true });

console.log(`Installing Playwright ${PLAYWRIGHT} into the bundled Python…`);
const env = { ...process.env, PYTHONNOUSERSITE: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1' };
execFileSync(python, ['-m', 'pip', 'install', '--no-cache-dir', '--no-warn-script-location', `playwright==${PLAYWRIGHT}`], { env, stdio: 'inherit' });
// Only the Playwright client is used; the practice browser is reached over CDP. Precompile so the
// signed app bundle never needs to write __pycache__ at runtime.
// compileall exits non-zero for a few intentionally invalid stdlib test files, so do not fail on it.
try { execFileSync(python, ['-m', 'compileall', '-q', '-j', '0', target], { env, stdio: 'inherit' }); }
catch { console.warn('Some files could not be precompiled; continuing.'); }
execFileSync(python, ['-c', 'import playwright.sync_api, sys; print("Bundled", sys.version.split()[0])'], { env, stdio: 'inherit' });
fs.writeFileSync(stamp, JSON.stringify(wanted, null, 2));
console.log(`Bundled Python is ready at ${path.relative(root, target)}.`);
