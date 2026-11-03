import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runChecks } from '../scripts/doctor.mjs';

function fixture(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const homeDir = path.join(rootDir, 'home');
  const env = { SITE_DOMAIN: 'https://test.example:8443/en/', PLAYWRIGHT_USERNAME: 'fixture-account' };
  const write = (relativePath, content = '{}') => {
    const target = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    return target;
  };
  for (const dir of ['node_modules', 'home/.cache/ms-playwright/chromium-123']) {
    fs.mkdirSync(path.join(rootDir, dir), { recursive: true });
  }
  write('.env', 'SITE_DOMAIN=https://from-file.example\nACCOUNT=file-account\n');
  write('profiles/123.json');
  write('sites/test.example:8443/123.baseline.json');
  write('src/fixtures/storageState-fixture.json');
  return { rootDir, homeDir, env, write };
}

const byId = (results, id) => {
  const result = results.find(result => result.id === id);
  assert.ok(result, `missing check: ${id}`);
  return result;
};

test('完整环境执行 10 项，本机 Node 版本通过，并创建 reports/', async t => {
  const options = fixture(t);
  const results = await runChecks({ ...options, blockId: '123' });
  assert.equal(results.length, 10);
  assert.equal(new Set(results.map(result => result.id)).size, 10);
  assert.ok(results.every(result => result.status === 'pass'));
  assert.match(byId(results, 'node').detail, new RegExp(process.versions.node.replaceAll('.', '\\.')));
  assert.ok(fs.statSync(path.join(options.rootDir, 'reports')).isDirectory());
});

test('Node 18 通过，Node 17 失败且有修复建议', async t => {
  const options = fixture(t);
  for (const [nodeVersion, status] of [['18.0.0', 'pass'], ['17.9.1', 'fail']]) {
    const result = byId(await runChecks({ ...options, nodeVersion }), 'node');
    assert.equal(result.status, status);
    if (status === 'fail') assert.ok(result.fix);
  }
});

test('缺少 node_modules 时失败', async t => {
  const options = fixture(t);
  fs.rmSync(path.join(options.rootDir, 'node_modules'), { recursive: true });
  const result = byId(await runChecks(options), 'dependencies');
  assert.equal(result.status, 'fail');
  assert.match(result.fix, /npm ci/);
});

test('SITE_DOMAIN 空时失败，不从 fixture .env 或 process.env 补入值', async t => {
  const options = fixture(t);
  const result = byId(await runChecks({ ...options, env: { ...options.env, SITE_DOMAIN: ' ' } }), 'env');
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /SITE_DOMAIN/);
  assert.match(result.fix, /\.env/);
});

test('账号接受三种变量，空白账号失败，结果不包含账号或密码值', async t => {
  const options = fixture(t);
  for (const key of ['PLAYWRIGHT_USERNAME', 'PLAYWRIGHT_ACCOUNT', 'ACCOUNT']) {
    const env = { SITE_DOMAIN: options.env.SITE_DOMAIN, [key]: 'private-account', PLAYWRIGHT_PASSWORD: 'private-password' };
    const results = await runChecks({ ...options, env });
    assert.equal(byId(results, 'env').status, 'pass');
    assert.doesNotMatch(JSON.stringify(results), /private-account|private-password/);
  }
  assert.equal(byId(await runChecks({ ...options, env: { SITE_DOMAIN: options.env.SITE_DOMAIN, ACCOUNT: ' ' } }), 'env').status, 'fail');
});

test('坏画像报告文件名和解析错误，跳过模板、非 JSON 和目录', async t => {
  const options = fixture(t);
  options.write('profiles/broken.json', '{ invalid');
  options.write('profiles/TEMPLATE.json', 'not json');
  options.write('profiles/README.md', 'not json');
  fs.mkdirSync(path.join(options.rootDir, 'profiles', 'directory.json'));
  let result = byId(await runChecks(options), 'profiles');
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /profiles\/broken\.json: .+/);
  assert.doesNotMatch(result.detail, /TEMPLATE|README|directory/);
  fs.unlinkSync(path.join(options.rootDir, 'profiles', 'broken.json'));
  result = byId(await runChecks(options), 'profiles');
  assert.equal(result.status, 'pass');
});

test('sites 为空或缺失时基线警告，指定区块时失败', async t => {
  const options = fixture(t);
  fs.rmSync(path.join(options.rootDir, 'sites'), { recursive: true });
  for (const createSites of [false, true]) {
    if (createSites) fs.mkdirSync(path.join(options.rootDir, 'sites'));
    assert.equal(byId(await runChecks(options), 'baseline').status, 'warn');
    const result = byId(await runChecks({ ...options, blockId: '123' }), 'baseline');
    assert.equal(result.status, 'fail');
    assert.match(result.fix, /123\.baseline\.json/);
  }
});

test('其他区块基线不能满足指定区块要求', async t => {
  const options = fixture(t);
  const result = byId(await runChecks({ ...options, blockId: '456' }), 'baseline');
  assert.equal(result.status, 'fail');
});

test('指定区块画像缺失时失败，未指定区块时通过', async t => {
  const options = fixture(t);
  const result = byId(await runChecks({ ...options, blockId: '456' }), 'block-profile');
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /456\.json/);
  assert.ok(result.fix);
  assert.equal(byId(await runChecks(options), 'block-profile').status, 'pass');
});

test('离线模式仅执行前 7 项', async t => {
  const options = fixture(t);
  fs.rmSync(path.join(options.rootDir, 'src'), { recursive: true });
  const results = await runChecks({ ...options, offlineOnly: true });
  assert.equal(results.length, 7);
  assert.deepEqual(results.map(result => result.id), ['node', 'dependencies', 'browser', 'env', 'profiles', 'baseline', 'reports']);
});

test('浏览器按配置匹配安装目录，普通文件和其他浏览器不算安装', async t => {
  const options = fixture(t);
  const firefoxOptions = { ...options, env: { ...options.env, BROWSER: 'firefox' } };
  options.write('home/.cache/ms-playwright/firefox-123', 'not a directory');
  const result = byId(await runChecks(firefoxOptions), 'browser');
  assert.equal(result.status, 'fail');
  assert.equal(result.fix, 'npx playwright install firefox');
  fs.mkdirSync(path.join(options.homeDir, '.cache', 'ms-playwright', 'firefox-456'));
  assert.equal(byId(await runChecks(firefoxOptions), 'browser').status, 'pass');
});

test('缺失浏览器缓存给出 Chromium 安装建议，不支持的 BROWSER 失败', async t => {
  const options = fixture(t);
  fs.rmSync(options.homeDir, { recursive: true });
  const result = byId(await runChecks(options), 'browser');
  assert.equal(result.status, 'fail');
  assert.equal(result.fix, 'npx playwright install chromium');
  assert.equal(byId(await runChecks({ ...options, env: { ...options.env, BROWSER: 'webkit' } }), 'browser').status, 'fail');
});

test('登录态缺失失败，超过 7 天警告且不暴露文件中的账号', async t => {
  const options = fixture(t);
  const state = path.join(options.rootDir, 'src', 'fixtures', 'storageState-fixture.json');
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  fs.utimesSync(state, old, old);
  const result = byId(await runChecks(options), 'storage-state');
  assert.equal(result.status, 'warn');
  assert.match(result.detail, /可能过期/);
  assert.equal(result.fix, 'node scripts/explore-login.mjs --force-login');
  fs.unlinkSync(state);
  assert.equal(byId(await runChecks(options), 'storage-state').status, 'fail');
});

test('站点校验格式和含端口的 host，无基线目录时仅校验格式', async t => {
  const options = fixture(t);
  for (const domain of ['test.example:8443', 'ftp://test.example:8443', 'https://', 'https://other.example', 'https://test.example']) {
    const results = await runChecks({ ...options, env: { ...options.env, SITE_DOMAIN: domain } });
    assert.equal(byId(results, 'site-domain').status, 'fail', domain);
  }
  fs.rmSync(path.join(options.rootDir, 'sites'), { recursive: true });
  assert.equal(byId(await runChecks(options), 'site-domain').status, 'pass');
});

test('reports 路径被普通文件占用时失败，其他检查仍完成且所有失败有修复建议', async t => {
  const options = fixture(t);
  options.write('reports', 'not a directory');
  const results = await runChecks({ ...options, env: {}, blockId: '456' });
  assert.equal(results.length, 10);
  assert.equal(byId(results, 'reports').status, 'fail');
  for (const result of results.filter(result => result.status === 'fail')) assert.ok(result.fix);
});

test('区块 ID 拒绝空值和路径，避免读取目标目录之外的文件', async t => {
  const options = fixture(t);
  for (const blockId of ['', '../123', '/tmp/123']) {
    await assert.rejects(runChecks({ ...options, blockId }), /区块 ID/);
  }
});

test('无效画像逐一报告；单个检查失败不会阻断其余检查', async t => {
  const options = fixture(t);
  options.write('profiles/broken-a.json', '{');
  options.write('profiles/broken-b.json', '[');
  const results = await runChecks(options);
  assert.equal(results.length, 10);
  const result = byId(results, 'profiles');
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /broken-a\.json/);
  assert.match(result.detail, /broken-b\.json/);
  assert.equal(byId(results, 'block-profile').status, 'pass');
});
