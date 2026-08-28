/**
 * macOS Dock / ⌘-Tab / menu-bar name in `npm run dev`.
 *
 * Dev runs node_modules/electron/dist/Electron.app. The OS reads that bundle's
 * Info.plist before any JS (app.setName / productName cannot change the Dock).
 * Packaged builds already pick up package.json productName.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const PRODUCT_NAME = 'AI Creative Workstation';
const BUNDLE_ID = 'com.aicreativeworkstation.app';

if (process.platform !== 'darwin') {
  process.exit(0);
}

const require = createRequire(import.meta.url);
let electronBin;
try {
  electronBin = require('electron');
} catch {
  process.exit(0);
}

if (typeof electronBin !== 'string') {
  process.exit(0);
}

const appDir = join(dirname(electronBin), '../..');
const plistPath = join(appDir, 'Contents', 'Info.plist');
if (!existsSync(plistPath)) {
  process.exit(0);
}

function plistGet(key) {
  try {
    return execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plistPath], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}

function plistSet(key, value) {
  const quoted = JSON.stringify(value);
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${quoted}`, plistPath]);
  } catch {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${quoted}`, plistPath]);
  }
}

const keys = {
  CFBundleName: PRODUCT_NAME,
  CFBundleDisplayName: PRODUCT_NAME,
  CFBundleIdentifier: BUNDLE_ID,
};

let changed = false;
for (const [key, value] of Object.entries(keys)) {
  if (plistGet(key) !== value) {
    plistSet(key, value);
    changed = true;
  }
}

if (changed) {
  const lsregister =
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
  if (existsSync(lsregister)) {
    try {
      execFileSync(lsregister, ['-f', appDir], { stdio: 'ignore' });
    } catch {
      // Launch Services refresh is best-effort.
    }
  }
  console.log(`Dev Electron bundle labeled "${PRODUCT_NAME}" (Dock / menu). Restart npm run dev if it still says Electron.`);
}
