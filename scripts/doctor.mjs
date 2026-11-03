import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const loginFix = 'node scripts/explore-login.mjs --force-login';

async function entries(directory) {
  try {
    return await fs.promises.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function validBlockId(blockId) {
  return typeof blockId === 'string' && /^[a-zA-Z0-9_-]+$/.test(blockId);
}

/** Run local preflight checks. Importing this module never loads .env.
 * env is the complete configuration; homeDir isolates the browser cache in tests.
 * The only filesystem write is creating reports/ when it is absent.
 */
export async function runChecks({
  rootDir = repositoryRoot,
  offlineOnly = false,
  blockId,
  env = process.env,
  homeDir = os.homedir(),
  nodeVersion = process.versions.node,
} = {}) {
  if (blockId !== undefined && !validBlockId(blockId)) {
    throw new Error('区块 ID 只能包含字母、数字、下划线或连字符');
  }

  const results = [];
  async function check(id, name, fix, inspect) {
    try {
      const result = await inspect();
      results.push({ id, name, ...result, ...(result.status === 'pass' ? {} : { fix }) });
    } catch (error) {
      results.push({ id, name, status: 'fail', detail: error.message, fix });
    }
  }

  await check('node', 'Node 版本', '安装 Node.js 18 或更高版本', () => ({
    status: Number(nodeVersion.split('.')[0]) >= 18 ? 'pass' : 'fail',
    detail: `v${nodeVersion}（要求 >= 18）`,
  }));

  await check('dependencies', '依赖安装', '在仓库根目录运行 npm ci', async () => ({
    status: (await fs.promises.stat(path.join(rootDir, 'node_modules'))).isDirectory() ? 'pass' : 'fail',
    detail: 'node_modules 应为已安装的依赖目录',
  }));

  const browser = env.BROWSER?.trim() || 'chromium';
  const supportedBrowser = ['firefox', 'chromium'].includes(browser);
  await check('browser', `浏览器 (${browser})`, supportedBrowser
    ? `npx playwright install ${browser}` : '检查 .env，将 BROWSER 设为 firefox 或 chromium', async () => {
    if (!supportedBrowser) return { status: 'fail', detail: 'BROWSER 仅支持 firefox/chromium' };
    const cache = await entries(path.join(homeDir, '.cache', 'ms-playwright'));
    const installed = cache.some(entry => entry.isDirectory() && entry.name.startsWith(`${browser}-`));
    return {
      status: installed ? 'pass' : 'fail',
      detail: installed ? '已找到浏览器安装目录'
        : `未找到已安装的 ${browser === 'firefox' ? 'Firefox' : 'Chromium'}（~/.cache/ms-playwright 下无 ${browser}-* 目录）`,
    };
  });

  await check('env', '.env 必填项', '检查仓库根目录 .env 文件，填写 SITE_DOMAIN 和任一账号变量', () => {
    const missing = [];
    if (!env.SITE_DOMAIN?.trim()) missing.push('SITE_DOMAIN');
    if (!['PLAYWRIGHT_USERNAME', 'PLAYWRIGHT_ACCOUNT', 'ACCOUNT'].some(key => env[key]?.trim())) {
      missing.push('PLAYWRIGHT_USERNAME/PLAYWRIGHT_ACCOUNT/ACCOUNT');
    }
    return { status: missing.length ? 'fail' : 'pass', detail: missing.length ? `缺少 ${missing.join('、')}` : '必填项齐全' };
  });

  await check('profiles', '画像 JSON', '检查并修正对应 profiles/*.json 文件的 JSON 语法', async () => {
    const directory = path.join(rootDir, 'profiles');
    // A missing profiles directory is a configuration error, not an empty valid set.
    const profiles = (await fs.promises.readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'TEMPLATE.json')
      .sort((a, b) => a.name.localeCompare(b.name));
    const errors = [];
    for (const profile of profiles) {
      try {
        JSON.parse(await fs.promises.readFile(path.join(directory, profile.name), 'utf8'));
      } catch (error) {
        errors.push(`profiles/${profile.name}: ${error.message}`);
      }
    }
    return { status: errors.length ? 'fail' : 'pass', detail: errors.length ? errors.join('；') : `${profiles.length} 份画像 JSON 合法` };
  });

  await check('baseline', '基线文件', blockId
    ? `按仓库基线流程准备 sites/<host>/${blockId}.baseline.json`
    : '按仓库基线流程准备 sites/<host>/<区块ID>.baseline.json', async () => {
    const sitesDir = path.join(rootDir, 'sites');
    const sites = (await entries(sitesDir)).filter(entry => entry.isDirectory());
    let count = 0;
    for (const site of sites) {
      count += (await entries(path.join(sitesDir, site.name))).filter(entry => entry.isFile()
        && (blockId ? entry.name === `${blockId}.baseline.json` : entry.name.endsWith('.baseline.json'))).length;
    }
    return {
      status: count ? 'pass' : blockId ? 'fail' : 'warn',
      detail: count ? `找到 ${count} 份${blockId ? `区块 ${blockId} 的` : ''}基线`
        : `未找到${blockId ? `区块 ${blockId} 的` : '任何'}基线文件`,
    };
  });

  await check('reports', 'reports 目录可写', '检查 reports/ 路径及当前用户的目录写权限', async () => {
    const directory = path.join(rootDir, 'reports');
    await fs.promises.mkdir(directory, { recursive: true });
    await fs.promises.access(directory, fs.constants.W_OK);
    return { status: 'pass', detail: 'reports/ 可写' };
  });

  if (offlineOnly) return results;

  // These checks only inspect local metadata; they do not authenticate or write to a site.
  await check('storage-state', '登录态文件', loginFix, async () => {
    const directory = path.join(rootDir, 'src', 'fixtures');
    const states = (await entries(directory)).filter(entry => entry.isFile()
      && /^storageState-.+\.json$/.test(entry.name));
    if (!states.length) return { status: 'fail', detail: '未找到 src/fixtures/storageState-*.json' };
    let stale = 0;
    for (const state of states) {
      const { mtimeMs } = await fs.promises.stat(path.join(directory, state.name));
      if (Date.now() - mtimeMs > 7 * 24 * 60 * 60 * 1000) stale++;
    }
    return {
      status: stale ? 'warn' : 'pass',
      detail: stale ? `${states.length} 份登录态中有 ${stale} 份超过 7 天，可能过期`
        : `找到 ${states.length} 份登录态（未验证登录有效性）`,
    };
  });

  await check('site-domain', '站点地址', '检查 .env 的 SITE_DOMAIN，使用 http(s):// 地址并与 sites/<host>/ 基线目录一致', async () => {
    const domain = env.SITE_DOMAIN?.trim() || '';
    let url;
    try {
      url = new URL(domain);
    } catch {
      return { status: 'fail', detail: 'SITE_DOMAIN 不是合法的 http(s):// 地址' };
    }
    if (!/^https?:\/\//i.test(domain) || !['http:', 'https:'].includes(url.protocol) || !url.hostname) {
      return { status: 'fail', detail: 'SITE_DOMAIN 必须是以 http(s):// 开头的合法地址' };
    }
    const sites = (await entries(path.join(rootDir, 'sites'))).filter(entry => entry.isDirectory());
    const matches = sites.some(entry => entry.name.toLowerCase() === url.host.toLowerCase());
    return {
      status: sites.length && !matches ? 'fail' : 'pass',
      detail: sites.length ? matches ? '站点 host 与基线目录一致' : '站点 host 与 sites/ 下已有基线目录不一致'
        : '站点格式合法；无基线目录可供核对',
    };
  });

  await check('block-profile', '指定区块画像', '检查 --block 参数，并准备对应的 profiles/<区块ID>.json', async () => {
    if (blockId === undefined) return { status: 'pass', detail: '未指定 --block，无需检查指定画像' };
    const exists = (await fs.promises.stat(path.join(rootDir, 'profiles', `${blockId}.json`))).isFile();
    return { status: exists ? 'pass' : 'fail', detail: `profiles/${blockId}.json 应为画像文件` };
  });

  return results;
}

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') options.help = true;
    else if (arg === '--offline-only') options.offlineOnly = true;
    else if (arg === '--block') {
      const blockId = args[++i];
      if (!validBlockId(blockId) || blockId.startsWith('--')) throw new Error('--block 需要有效的区块 ID');
      options.blockId = blockId;
    } else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log('用法：node scripts/doctor.mjs [--offline-only] [--block <id>] [--help]\n'
        + '默认执行 10 项检查；--offline-only 仅执行前 7 项。\n'
        + '登录态仅检查文件和时间，不验证实际登录有效性，不访问或修改站点。');
      return;
    }
    dotenv.config({ path: path.join(repositoryRoot, '.env'), quiet: true });
    const results = await runChecks(options);
    const labels = { pass: '通过', fail: '失败', warn: '警告' };
    results.forEach((result, index) => {
      console.log(`[doctor] ${index + 1}/${results.length} ${result.name}: ${labels[result.status]}`
        + `${result.detail ? ` - ${result.detail}` : ''}${result.fix ? `。修复：${result.fix}` : ''}`);
    });
    const counts = { pass: 0, fail: 0, warn: 0 };
    for (const result of results) counts[result.status]++;
    console.log(`[doctor] 总结: ${counts.pass} 通过 / ${counts.fail} 失败${counts.warn ? ` / ${counts.warn} 警告` : ''}`);
    process.exitCode = counts.fail ? 1 : 0;
  } catch (error) {
    console.error(`[doctor] 错误：${error.message}。修复：使用 --help 查看用法`);
    process.exitCode = 1;
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
