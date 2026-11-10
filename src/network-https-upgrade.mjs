const DEFAULT_HOSTS = Object.freeze([
  'website.leadong.com',
  'www.leadong.com',
  '*.preview.leadong.com',
  '*.leadongcdn.com',
]);
const FRONTEND_SUFFIXES = Object.freeze(['ldwebsite.com', 'ldyjz.com', 'ldmfyh.com']);

export const CHROMIUM_DISABLE_HTTPS_UPGRADES_ARGS = Object.freeze([
  // Chromium may auto-upgrade http://*.ldwebsite.com to https://, but many
  // Leadong test fronts only serve content on HTTP while HTTPS returns nginx 403.
  // Front-only runners must stay on the requested scheme.
  '--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable,HttpsFirstModeV2',
]);


function normalizeRule(value) {
  if (typeof value !== 'string') throw new TypeError('HTTPS_UPGRADE_HOSTS must contain host names');
  const rule = value.trim().toLowerCase().replace(/\.$/, '');
  if (!rule) return '';
  const host = rule.startsWith('*.') ? rule.slice(2) : rule;
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || host.includes('..')) {
    throw new TypeError('HTTPS_UPGRADE_HOSTS must contain host names or *.suffix rules, without scheme, port, or path');
  }
  return rule;
}

export function parseHttpsUpgradeHosts(value = DEFAULT_HOSTS) {
  const entries = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(entries.map(normalizeRule).filter(Boolean))];
}

export function isFrontendHost(hostname) {
  const host = String(hostname).toLowerCase().replace(/\.$/, '');
  return FRONTEND_SUFFIXES.some(suffix => host === suffix || host.endsWith(`.${suffix}`));
}

export function matchesHttpsUpgradeHost(hostname, rules = DEFAULT_HOSTS) {
  const host = String(hostname).toLowerCase().replace(/\.$/, '');
  if (!host || isFrontendHost(host)) return false;
  return parseHttpsUpgradeHosts(rules).some(rule => rule.startsWith('*.')
    ? host.endsWith(`.${rule.slice(2)}`) && host !== rule.slice(2)
    : host === rule);
}

export function httpsUpgradeEnabled(value = process.env.HTTPS_UPGRADE) {
  if (value === undefined || value === '') return true;
  return !['0', 'false', 'off'].includes(String(value).trim().toLowerCase());
}

export function upgradeHttpUrl(value, rules = DEFAULT_HOSTS) {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' && matchesHttpsUpgradeHost(url.hostname, rules)) {
      url.protocol = 'https:';
      return url.href;
    }
  } catch { /* Relative Location values are unchanged. */ }
  return value;
}

export function rewriteUpgradeLocation(headers, rules = DEFAULT_HOSTS) {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [
    name, name.toLowerCase() === 'location' ? upgradeHttpUrl(value, rules) : value,
  ]));
}

function isDowngradeLoop(location, sourceUrl, rules) {
  try {
    const target = new URL(location);
    const source = new URL(sourceUrl);
    return target.protocol === 'http:' && ['http:', 'https:'].includes(source.protocol)
      && matchesHttpsUpgradeHost(target.hostname, rules)
      && matchesHttpsUpgradeHost(source.hostname, rules)
      && upgradeHttpUrl(target.href, rules) === upgradeHttpUrl(source.href, rules);
  } catch { return false; }
}

export async function installHttpsUpgrade(context, rules = DEFAULT_HOSTS) {
  const hosts = parseHttpsUpgradeHosts(rules);
  if (!hosts.length) return;
  // Context routing applies to main pages, iframe requests, and popup first navigations.
  // Intercept HTTPS responses too: browser-followed redirects may bypass routing
  // for the subsequent HTTP request, so Location must be rewritten first.
  await context.route(url => ['http:', 'https:'].includes(url.protocol) && matchesHttpsUpgradeHost(url.hostname, hosts), async route => {
    let response;
    try {
      const request = route.request();
      response = await route.fetch({
        url: upgradeHttpUrl(request.url(), hosts), maxRedirects: 0, timeout: 60000,
      });
      const headers = response.headers();
      if (headers.location && isDowngradeLoop(headers.location, request.url(), hosts)) {
        console.warn('[https-upgrade] HTTPS_UPGRADE_DOWNGRADE_LOOP: HTTPS upgrade downgrade loop detected. The HTTPS endpoint redirected back to HTTP; if plaintext HTTP is blocked (for example by Pingora), use a reachable published front or fix the network route.');
        await route.abort('failed');
        return;
      }
      await route.fulfill({ response, status: response.status(), headers: rewriteUpgradeLocation(headers, hosts), body: await response.body() });
    } catch {
      // Requests can fail or their browser context can close while a route is in flight.
      // Neither the exception nor request URLs are safe to log: they may contain secrets.
      console.warn('[https-upgrade] Request failed; aborting route.');
      await route.abort('failed').catch(() => {});
    } finally {
      if (response) await response.dispose().catch(() => {});
    }
  });
}

export { DEFAULT_HOSTS as DEFAULT_HTTPS_UPGRADE_HOSTS };
