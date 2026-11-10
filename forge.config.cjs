// Electron Forge packaging for Wander.app and its DMG. Run through scripts/build-mac.sh, which first
// builds the Swift helper and stages the bundled Python into build/.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const identity = process.env.APPLE_SIGN_IDENTITY; // e.g. "Developer ID Application: Your Name (TEAMID)"
const notarize = identity && process.env.APPLE_ID && process.env.APPLE_APP_PASSWORD && process.env.APPLE_TEAM_ID;
const entitlements = path.join(__dirname, 'desktop', 'entitlements.plist');

function isMachO(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const magic = Buffer.alloc(4);
    if (fs.readSync(fd, magic, 0, 4, 0) < 4) return false;
    return ['cffaedfe', 'feedfacf', 'cefaedfe', 'feedface', 'cafebabe', 'bebafeca'].includes(magic.toString('hex'));
  } catch { return false; } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (entry.isFile()) yield full;
  }
}

module.exports = {
  packagerConfig: {
    name: 'Wander',
    executableName: 'Wander',
    appBundleId: 'app.wander.desktop',
    appCategoryType: 'public.app-category.education',
    // No asar: the server runs as plain files in a utility process and copies its Python runtime script out.
    asar: false,
    extraResource: ['build/python', 'build/wander-helper', 'extension'],
    ignore: [
      /^\/(vendor|native|build|out|tests|promo|docs|scripts|artifacts|\.wander|\.wander-video-deps|\.github)(\/|$)/,
      /^\/\.env/, /^\/Start Wander\.command$/, /^\/forge\.config\.cjs$/, /^\/pnpm-lock\.yaml$/
    ],
    extendInfo: { LSMinimumSystemVersion: '13.0' },
    ...(identity ? {
      osxSign: {
        identity,
        optionsForFile: () => ({ hardenedRuntime: true, entitlements })
      }
    } : {}),
    ...(notarize ? {
      osxNotarize: { appleId: process.env.APPLE_ID, appleIdPassword: process.env.APPLE_APP_PASSWORD, teamId: process.env.APPLE_TEAM_ID }
    } : {})
  },
  makers: [
    { name: '@electron-forge/maker-dmg', platforms: ['darwin'], config: { name: 'Wander', format: 'ULFO' } },
    { name: '@electron-forge/maker-zip', platforms: ['darwin'] }
  ],
  hooks: {
    // Without a Developer ID, ad-hoc sign every native binary so the app runs on Apple Silicon.
    // Testers must then approve it once in System Settings (see TESTING.md).
    postPackage: async (_config, { outputPaths, platform }) => {
      if (platform !== 'darwin' || identity) return;
      for (const output of outputPaths) {
        const bundle = path.join(output, 'Wander.app');
        const nested = path.join(bundle, 'Contents', 'Resources');
        for (const file of files(nested)) {
          if (isMachO(file)) execFileSync('codesign', ['--force', '--sign', '-', file], { stdio: 'inherit' });
        }
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'inherit' });
        console.log(`Ad-hoc signed ${bundle}`);
      }
    }
  }
};
