// Shared test browser configuration.
// Centralizes the "which browser to launch" decision so tests don't hardcode
// `channel: 'chrome'` (which requires a system Chrome that may not exist).
// Prefers system Chrome when available (matches .env BROWSER=chromium default),
// falls back to Playwright's bundled Chromium otherwise.
import fs from 'node:fs';

const SYSTEM_CHROME_PATHS = [
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

let cached = null;

export function testBrowserConfig() {
  if (cached) return cached;
  // Allow override via env (e.g. CI with a specific browser).
  if (process.env.TEST_BROWSER_CHANNEL) {
    cached = { channel: process.env.TEST_BROWSER_CHANNEL, headless: true };
    return cached;
  }
  const systemChrome = SYSTEM_CHROME_PATHS.find((p) => {
    try { return fs.existsSync(p); } catch { return false; }
  });
  if (systemChrome) {
    cached = { channel: 'chrome', headless: true };
  } else {
    // Playwright's bundled Chromium; no channel needed.
    cached = { headless: true };
  }
  return cached;
}

// Pre-flight check: fail fast with a clear message if no browser is available.
export function assertBrowserAvailable() {
  const cfg = testBrowserConfig();
  if (cfg.channel === 'chrome') {
    const found = SYSTEM_CHROME_PATHS.some((p) => {
      try { return fs.existsSync(p); } catch { return false; }
    });
    if (!found) {
      throw new Error(
        'Test requires system Chrome (channel: "chrome") but none found at ' +
        SYSTEM_CHROME_PATHS.join(', ') +
        '. Install Chrome or set TEST_BROWSER_CHANNEL to override.'
      );
    }
  }
  return cfg;
}
