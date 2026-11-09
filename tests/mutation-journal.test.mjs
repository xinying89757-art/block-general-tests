import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findPendingJournals, getPendingMutations, logMutation, markDone, markFailed,
  openJournal, recoverFromJournal } from '../src/mutation-journal.mjs';
import { readSiteBaseline, siteBaselinePath, writeSiteBaseline } from '../src/site-baseline.mjs';

/**
 * Isolate every test's journals and restore the environment on completion.
 * Tests in this file run sequentially because JOURNAL_DIR is process-global.
 * @param {import('node:test').TestContext} t Test context.
 * @returns {Promise<string>} Temporary root.
 */
async function temporaryRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mutation-journal-'));
  const previous = process.env.JOURNAL_DIR;
  process.env.JOURNAL_DIR = path.join(root, 'journals');
  t.after(async () => {
    if (previous === undefined) delete process.env.JOURNAL_DIR;
    else process.env.JOURNAL_DIR = previous;
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

/** @returns {Object} Serializable width intent with complete known target identity. */
function intent() {
  const before = { effective: 1440, checked: { label: '自定义', value: '-1' }, customVal: '1440' };
  return { op: 'set-setting',
    target: { siteHost: 'example.test:8443', language: '英语', pageId: '42', pageKind: 'custom', blockId: '47748', instanceId: 'instance-1' },
    before, after: { preset: '1200px' },
    restore: { kind: 'set-setting', settingKey: 'module-width', value: before } };
}

/** @param {string} file JSONL filename. @returns {Promise<Object[]>} Parsed rows. */
async function rows(file) {
  return (await fs.readFile(file, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
}

test('WAL started intent is on disk before the simulated site write', async (t) => {
  await temporaryRoot(t);
  const journal = await openJournal('wal-order');
  assert.equal(journal.nextSeq, 1);
  const seq = await logMutation(journal, intent());
  // A caller cannot begin its site write until logMutation has resolved.
  const persisted = await rows(journal.path);
  assert.equal(persisted[0].status, 'started');
  await fs.appendFile(journal.path, `${JSON.stringify({ simulatedSiteWrite: true })}\n`);
  const recorded = await rows(journal.path);
  assert.equal(recorded[0].seq, seq);
  assert.equal(recorded[0].runId, 'wal-order');
  assert.deepEqual(recorded[0].restore, intent().restore);
  assert.ok(Number.isFinite(Date.parse(recorded[0].ts)));
  assert.equal(recorded[1].simulatedSiteWrite, true);
  assert.equal(journal.nextSeq, 2);
});

test('pending entries fold terminal rows and survive reopening without sequence reuse', async (t) => {
  await temporaryRoot(t);
  const journal = await openJournal('fold');
  const done = await logMutation(journal, intent());
  const failed = await logMutation(journal, intent());
  await markDone(journal, done);
  await markFailed(journal, failed, new Error('write rejected'));
  assert.deepEqual(await getPendingMutations('fold'), []);
  const reopened = await openJournal('fold');
  assert.equal(reopened.nextSeq, 3);
  const pending = await logMutation(reopened, intent());
  assert.equal(pending, 3);
  assert.deepEqual((await getPendingMutations('fold')).map((entry) => entry.seq), [3]);
  assert.equal((await rows(journal.path)).find((entry) => entry.status === 'failed').error, 'write rejected');
});

test('intent and status writes await fsync, and a durability failure prevents the caller write', async (t) => {
  await temporaryRoot(t);
  const journal = await openJournal('durability');
  const open = fs.open.bind(fs);
  const events = [];
  let rejectSync = false;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args);
    if (args[0] === journal.path) {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        if (rejectSync) throw new Error('simulated disk sync failure');
        await sync();
        events.push('fsync-complete');
      };
    }
    return handle;
  });
  const seq = await logMutation(journal, intent());
  events.push('site-write');
  await markDone(journal, seq);
  assert.deepEqual(events, ['fsync-complete', 'site-write', 'fsync-complete']);
  rejectSync = true;
  let wroteSite = false;
  await assert.rejects(async () => {
    await logMutation(journal, intent());
    wroteSite = true;
  }, /disk sync failure/);
  assert.equal(wroteSite, false);
});

test('recovery reverts confirmed work, records exceptions and retains unresolved work in order', async (t) => {
  await temporaryRoot(t);
  const journal = await openJournal('recover');
  for (let index = 0; index < 3; index += 1) await logMutation(journal, intent());
  const visited = [];
  const summary = await recoverFromJournal('recover', async (entry) => {
    visited.push(entry.seq);
    if (entry.seq === 1) return { recovered: true };
    if (entry.seq === 2) throw new Error('recovery failed');
    return { recovered: false, reason: 'no-executor-registered' };
  });
  assert.deepEqual(visited, [1, 2, 3]);
  assert.equal(summary.total, 3);
  assert.equal(summary.reverted, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.unresolved.length, 1);
  assert.equal(summary.unresolved[0].entry.seq, 3);
  assert.equal(summary.unresolved[0].reason, 'no-executor-registered');
  const recorded = await rows(journal.path);
  assert.equal(recorded.length, 5); // No status row for unresolved work.
  assert.equal(recorded[3].status, 'reverted');
  assert.equal(recorded[4].status, 'failed');
  assert.equal(recorded[4].error, 'recovery failed');
  assert.deepEqual((await getPendingMutations('recover')).map((entry) => entry.seq), [3]);
});

test('scanner returns only journals with started work and handles missing directories', async (t) => {
  await temporaryRoot(t);
  assert.deepEqual(await findPendingJournals(), []);
  assert.deepEqual(await getPendingMutations('missing'), []);
  await openJournal('empty');
  const done = await openJournal('done');
  await markDone(done, await logMutation(done, intent()));
  for (const runId of ['pending-b', 'pending-a']) await logMutation(await openJournal(runId), intent());
  await fs.writeFile(path.join(process.env.JOURNAL_DIR, 'ignored.txt'), 'not a journal');
  assert.deepEqual(await findPendingJournals(), ['pending-a', 'pending-b']);
});

test('parallel handles serialize sequence allocation and status appends', async (t) => {
  await temporaryRoot(t);
  const handles = await Promise.all([openJournal('parallel'), openJournal('parallel')]);
  const sequences = await Promise.all(Array.from({ length: 12 }, (_, index) => logMutation(handles[index % 2], intent())));
  assert.deepEqual(sequences, Array.from({ length: 12 }, (_, index) => index + 1));
  await Promise.all(sequences.map((seq) => markDone(handles[seq % 2], seq)));
  assert.equal((await rows(handles[0].path)).length, 24);
  assert.deepEqual(await getPendingMutations('parallel'), []);
});

test('crash-truncated final row is discarded before the next durable append', async (t) => {
  await temporaryRoot(t);
  const journal = await openJournal('truncated');
  await logMutation(journal, intent());
  await fs.appendFile(journal.path, '{"runId":"truncated","seq":2');
  assert.equal((await getPendingMutations('truncated')).length, 1);
  assert.equal(await logMutation(await openJournal('truncated'), intent()), 2);
  assert.deepEqual((await rows(journal.path)).map((entry) => entry.seq), [1, 2]);
});

test('complete malformed records fail closed rather than hiding pending work', async (t) => {
  await temporaryRoot(t);
  const journal = await openJournal('malformed');
  await fs.appendFile(journal.path, '{broken}\n');
  await assert.rejects(getPendingMutations('malformed'), SyntaxError);
  await assert.rejects(logMutation(journal, intent()), SyntaxError);
});

test('callbacks and non-JSON values are rejected before an intent is written', async (t) => {
  await temporaryRoot(t);
  const journal = await openJournal('serializable');
  for (const restore of [() => {}, { callback: () => {} }, { missing: undefined }, { value: NaN }]) {
    await assert.rejects(logMutation(journal, { ...intent(), restore }), /JSON/);
  }
  const cyclic = {};
  cyclic.value = cyclic;
  await assert.rejects(logMutation(journal, { ...intent(), restore: cyclic }), TypeError);
  assert.equal(await fs.readFile(journal.path, 'utf8'), '');
  assert.equal(await logMutation(journal, intent()), 1);
  await assert.rejects(markDone(journal, 99), /Unknown.*sequence/);
  await assert.rejects(openJournal('../escape'), /Invalid.*runId/);
});

test('page-scoped baseline paths and documents preserve legacy signatures', async (t) => {
  const root = await temporaryRoot(t);
  const host = 'example.test';
  const page = { pageKind: 'custom', pageId: '42' };
  const legacy = siteBaselinePath(root, host, '47748');
  const scoped = siteBaselinePath(root, host, '47748', page);
  assert.equal(legacy, path.join(root, 'sites', host, '47748.baseline.json'));
  assert.equal(scoped, path.join(root, 'sites', host, 'custom-42', '47748.baseline.json'));
  await writeSiteBaseline(root, host, '47748', [{ label: 'legacy' }]);
  const written = await writeSiteBaseline(root, host, '47748', [{ label: 'page' }], { page });
  assert.equal(written.file, scoped);
  assert.deepEqual(written.baseline.page, page);
  assert.deepEqual((await readSiteBaseline(root, host, '47748')).baseline.steps, [{ label: 'legacy' }]);
  assert.deepEqual((await readSiteBaseline(root, host, '47748', page)).baseline.steps, [{ label: 'page' }]);
  assert.throws(() => siteBaselinePath(root, host, '47748', { ...page, pageId: '../escape' }), /Invalid page/);
});

test('missing page baseline falls back to the legacy path with one warning', async (t) => {
  const root = await temporaryRoot(t);
  const written = await writeSiteBaseline(root, 'example.test', '47748', []);
  const warn = t.mock.method(console, 'warn', () => {});
  const page = { pageKind: 'system', pageId: 'products-42' };
  for (let index = 0; index < 2; index += 1) {
    const loaded = await readSiteBaseline(root, 'example.test', '47748', page);
    assert.equal(loaded.file, written.file);
    assert.deepEqual(loaded.baseline.steps, []);
  }
  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments[0], /legacy baseline/);
});

test('baseline page metadata must match page ID and kind, including legacy fallback reads', async (t) => {
  const root = await temporaryRoot(t);
  const page = { pageKind: 'custom', pageId: '42' };
  const written = await writeSiteBaseline(root, 'example.test', '47748', [], { page });
  for (const wrong of [{ ...page, pageId: '99' }, { ...page, pageKind: 'system' }]) {
    const file = siteBaselinePath(root, 'example.test', '47748', wrong);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.copyFile(written.file, file);
    await assert.rejects(readSiteBaseline(root, 'example.test', '47748', wrong), /page mismatch/);
  }
  await fs.copyFile(written.file, siteBaselinePath(root, 'example.test', '47748'));
  await assert.rejects(readSiteBaseline(root, 'example.test', '47748'), /page mismatch/);
  t.mock.method(console, 'warn', () => {});
  await assert.rejects(readSiteBaseline(root, 'example.test', '47748', { ...page, pageId: 'missing' }), /page mismatch/);
});

test('absent page and legacy baselines retain existing missing/cross-host behavior', async (t) => {
  const root = await temporaryRoot(t);
  const page = { pageKind: 'custom', pageId: '42' };
  assert.deepEqual(await readSiteBaseline(root, 'example.test', '47748', page), {
    file: siteBaselinePath(root, 'example.test', '47748', page), baseline: null,
  });
  await writeSiteBaseline(root, 'other.test', '47748', []);
  await assert.rejects(readSiteBaseline(root, 'example.test', '47748', page), /Site host mismatch/);
});

test('--recover-only works without block config and preserves pending entries with a nonzero exit', async (t) => {
  const root = await temporaryRoot(t);
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const env = { ...process.env, FIXTURE_OFFLINE: '1', BLOCK_ID: '', BROWSER: 'invalid', JOURNAL_DIR: process.env.JOURNAL_DIR };
  // The CLI is not a test worker; inheriting this routes its console to test IPC.
  delete env.NODE_TEST_CONTEXT;
  // File-backed stdio also works in runners that cannot capture child pipes.
  const run = async () => {
    const stdout = await fs.open(path.join(root, 'cli.stdout'), 'w');
    const stderr = await fs.open(path.join(root, 'cli.stderr'), 'w');
    let result;
    try {
      result = spawnSync(process.execPath, ['src/run.mjs', '--recover-only'], {
        cwd, timeout: 15_000, env, stdio: ['ignore', stdout.fd, stderr.fd],
      });
    } finally { await stdout.close(); await stderr.close(); }
    assert.ifError(result.error);
    return { ...result, stdout: await fs.readFile(path.join(root, 'cli.stdout'), 'utf8'),
      stderr: await fs.readFile(path.join(root, 'cli.stderr'), 'utf8') };
  };
  const empty = await run();
  assert.equal(empty.status, 0, empty.stderr);
  const journal = await openJournal('cli-pending');
  await logMutation(journal, intent());
  const pending = await run();
  assert.equal(pending.status, 1, pending.stderr);
  assert.match(pending.stdout, /"event":"pending"/, pending.stderr);
  const reports = pending.stdout.trim().split('\n').map((line) => JSON.parse(line.replace(/^\[mutation-journal\] /, '')));
  const entry = reports.find((report) => report.event === 'pending');
  assert.equal(entry.runId, 'cli-pending');
  assert.equal(entry.seq, 1);
  assert.equal(entry.op, 'set-setting');
  assert.equal(entry.status, 'started');
  assert.deepEqual(entry.target, intent().target);
  assert.deepEqual(entry.before, intent().before);
  assert.deepEqual(entry.after, intent().after);
  assert.match(pending.stdout, /no-executor-registered/);
  assert.equal((await rows(journal.path)).length, 1);
  assert.equal((await getPendingMutations('cli-pending')).length, 1);
});

// Load unchanged capability/helper bodies with ESM dependency fixtures. This
// avoids test-only exports and browser launches, and works without experimental
// node:test module mocking flags. Only imports and private test exports change.
let fixtureId = 0;
async function capabilityFixture(t, name, initialControls = [], options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-capability-'));
  const fixtureKey = `__journalCapability${fixtureId++}`;
  const bindings = {};
  globalThis[fixtureKey] = bindings;
  t.after(async () => { delete globalThis[fixtureKey]; await fs.rm(root, { recursive: true, force: true }); });
  const events = [], records = [];
  const journal = { nextSeq: 1, records };
  let controls = structuredClone(initialControls), stored = structuredClone(controls);
  let scheme = '#1C4587', color = 'rgb(10, 20, 30)', storedColor = color, linkType = '邮箱地址';
  const faults = { ...options };
  const recordWrite = (kind, value) => {
    events.push({ kind, value });
    if (faults.write) { faults.write = false; throw new Error('simulated setter failure'); }
  };
  const colorInput = {
    count: async () => options.color === false ? 0 : 1,
    inputValue: async () => color,
    evaluate: async () => {
      if (options.color === false) throw new Error('no color');
      return { value: color, readOnly: true, roles: 'colorPicker', title: '背景颜色', replacer: true };
    },
  };
  const rootLocator = {
    locator: () => colorInput,
    evaluate: async (fn, value) => {
      const source = String(fn);
      if (source.includes('tabs.every')) {
        if (value) { recordWrite('link-tab', value); linkType = value; }
        return { found: true, selected: linkType, tabs: [] };
      }
      if (source.includes('spectrum')) {
        recordWrite('color', value); color = value; return { available: true, value };
      }
      return controls.map((item) => item.index);
    },
  };
  const session = {
    root: rootLocator, structure: () => ({}),
    open: async () => { events.push({ kind: 'open' }); },
    cancel: async () => {
      events.push({ kind: 'cancel' }); controls = structuredClone(stored); color = storedColor;
    },
    read: async () => { events.push({ kind: 'read' }); return structuredClone(controls); },
    set: async (target, value) => {
      recordWrite('set', { index: target.index, value });
      const item = controls.find((item) => item.index === target.index);
      assert.ok(item, 'mock control identity must exist');
      if (item.type === 'radio' && value) controls.filter((other) => other.type === 'radio' && other.name === item.name)
        .forEach((other) => { other.checked = other.index === item.index; });
      else if (item.type === 'checkbox') item.checked = value;
      else item.value = value;
    },
    setMany: async (changes) => { for (const change of changes) await session.set(change.target, change.value); },
    save: async () => {
      events.push({ kind: 'save' });
      if (faults.save) { faults.save = false; throw new Error('simulated save failure'); }
      if (!faults.dropSave) { stored = structuredClone(controls); storedColor = color; }
      else { faults.dropSave = false; controls = structuredClone(stored); color = storedColor; }
    },
  };
  const wraps = options.wraps ?? [{ attributes: [{ name: 'data-settingid', value: 'instance-1' }], querySelectorAll: () => [] }];
  const wrap = {
    evaluateAll: async (fn) => { events.push({ kind: 'identity' }); return fn(wraps); },
    first: () => wrap, waitFor: async () => {}, count: async () => 0,
    locator: () => wrap, filter: () => wrap, isVisible: async () => true,
    evaluate: async () => {
      if (name !== 'block-color-scheme') throw new Error('simulated preview unavailable');
      return { buttonBg: scheme === '#FF0000' ? 'rgb(255, 0, 0)' : 'rgb(28, 69, 135)',
        buttonText: 'white', activePageBg: null, clearText: null, optAccent: null,
        optSpan: 'gray', cateText: 'gray', prodName: 'gray', inactivePage: null, cateRule: null };
    },
  };
  const canvas = { locator: () => wrap, waitForTimeout: async () => {} };
  const page = { locator: () => rootLocator };
  const context = { pages: () => [page] };
  const srcUrl = (file) => new URL(`../src/${file}`, import.meta.url).href;
  const writeModule = async (file, source) => {
    const output = path.join(root, file);
    await fs.writeFile(output, source);
    return new URL(`file://${output}`).href;
  };
  const stub = async (file, actualUrl, overrides) => {
    const actual = actualUrl ? await import(actualUrl) : {};
    bindings[file] = { ...actual, ...overrides };
    return writeModule(file, Object.keys(bindings[file]).map((key) =>
      `export const ${key} = globalThis[${JSON.stringify(fixtureKey)}][${JSON.stringify(file)}][${JSON.stringify(key)}];`).join('\n'));
  };
  const journalUrl = await stub('journal.mjs', null, {
    logMutation: async (handle, entry) => {
      assert.equal(handle, journal);
      assert.deepEqual(entry, JSON.parse(JSON.stringify(entry)), 'WAL intent must be plain JSON data');
      if (faults.log) throw new Error('simulated WAL failure');
      const seq = handle.nextSeq++;
      records.push({ ...structuredClone(entry), seq, status: 'started' });
      events.push({ kind: 'log', seq, op: entry.op });
      return seq;
    },
    markDone: async (handle, seq) => {
      assert.equal(handle, journal); records.push({ seq, status: 'done' }); events.push({ kind: 'done', seq });
    },
    markFailed: async (handle, seq, error) => {
      assert.equal(handle, journal); records.push({ seq, status: 'failed', error: error.message }); events.push({ kind: 'failed', seq });
    },
  });
  const editorUrl = await stub('editor.mjs', srcUrl('editor.mjs'), {
    savePage: async () => { events.push({ kind: 'save-page' }); },
    openPreview: async () => ({ frame: canvas, previewPage: page }),
  });
  const waitsUrl = await stub('waits.mjs', srcUrl('ui-waits.mjs'), {
    readBackWithRetry: async (read) => read(), waitForStable: async (read) => read(),
  });
  const rewrite = async (relative, file, dependencies, extra = '') => {
    const sourceUrl = new URL(relative, new URL('../src/', import.meta.url));
    const source = await fs.readFile(sourceUrl, 'utf8');
    const rewritten = source.replace(/(\b(?:from|import)\s*['"])(\.[^'"]+)(['"])/g,
      (_match, before, specifier, after) => `${before}${dependencies[specifier] || new URL(specifier, sourceUrl).href}${after}`);
    return writeModule(file, rewritten + extra);
  };
  const sharedBody = await rewrite('capabilities/shared.mjs', 'shared-body.mjs', {
    '../editor.mjs': editorUrl, '../mutation-journal.mjs': journalUrl, '../ui-waits.mjs': waitsUrl,
  });
  const sharedUrl = await stub('shared.mjs', sharedBody, {
    widgetSession: () => session, controlSession: () => session,
    poll: async (read, predicate) => { const value = await read(); return { matched: predicate(value), value }; },
  });
  const effectUrl = await rewrite('capabilities/effect-checks.mjs', 'effects.mjs', {
    '../editor.mjs': editorUrl, './shared.mjs': sharedUrl, '../mutation-journal.mjs': journalUrl, '../ui-waits.mjs': waitsUrl,
  });
  const railUrl = await stub('rail.mjs', srcUrl('capabilities/rail.mjs'), {
    openRailPanel: async () => ({}), readSchemeColor: async () => scheme,
    setSchemeColor: async (_canvas, value) => { recordWrite('scheme', value); scheme = value; },
    saveColorPanel: async () => { events.push({ kind: 'save-color' }); }, cancelColorPanel: async () => {},
  });
  const listEffectsUrl = await stub('list-effects.mjs', null, { cardFieldSnapshot: () => [], listSession: () => session, runProductListEffects: async () => [],
    displayFieldRequirements: () => [] });
  const extras = ['mutationTarget'];
  if (name === 'custom-filter-fields') extras.push('persistSpectrumColor');
  if (name === 'product-list-display') extras.push('dataSourceCategoryFrontCheck', 'compareFrontCheck');
  if (name === 'product-category-select') extras.push('categoryFrontCheck');
  const moduleUrl = await rewrite(`capabilities/${name}.mjs`, 'capability.mjs', {
    '../editor.mjs': editorUrl, './shared.mjs': sharedUrl, './effect-checks.mjs': effectUrl,
    '../mutation-journal.mjs': journalUrl, './rail.mjs': railUrl, './product-list-effects.mjs': listEffectsUrl,
  }, `\nexport { ${extras.join(', ')} };\n`);
  const module = await import(moduleUrl);
  const config = { siteDomain: 'https://en.example.test:8443/', blockId: '47748', pageId: '42',
    resolvedTarget: { kind: 'custom' }, deferFront: true, mutationJournal: journal };
  const profile = { target: { pageId: 'fallback', pageKind: 'system' },
    fixture: { fields: [{ name: 'AUTOTEST-Field' }], category: { name: 'AUTOTEST-Category' }, products: [{ name: 'AUTOTEST-Product' }] } };
  return { module, journal, events, records, session, canvas, config, profile, page, context, faults,
    args: { page, canvas, context, config, profile, capability: {}, report: {} },
    controls: () => structuredClone(controls), scheme: () => scheme, color: () => color };
}

function control(index, type, label, extra = {}) {
  return { index, tag: 'INPUT', type, name: label, label, context: label,
    value: type === 'text' ? '20' : String(index + 100), checked: false,
    disabled: false, readOnly: false, options: undefined, ...extra };
}
function radioPair(index, name, labels) {
  return labels.map((label, offset) => control(index + offset, 'radio', label, { name, checked: offset === 0 }));
}
const listControls = () => [control(0, 'text', '每页产品数量'),
  ...radioPair(1, 'pagination', ['是', '否']), ...radioPair(3, 'compare', ['关闭', '开启']),
  control(5, 'checkbox', 'Brand'), ...['所有产品', '使用筛选条件', '选择指定产品', '选择部分产品分类']
    .map((label, index) => control(6 + index, 'radio', label, { name: 'selectProdType', checked: index === 0 }))];
const filterControls = () => [control(0, 'checkbox', 'AUTOTEST-Field'),
  ...radioPair(1, 'logic', ['交集', '并集']), ...radioPair(3, 'trigger', ['点击“搜索”按钮', '更改筛选项后自动筛选']),
  ...radioPair(5, 'scope', ['当前分类产品', '所有产品']),
  control(7, 'select-one', '筛选后跳转页', { tag: 'SELECT', value: 'page-a', options: [
    { value: 'page-a', label: 'Page A', disabled: false }, { value: 'page-b', label: 'Page B', disabled: false }] })];
const buttonControls = () => [control(0, 'text', '按钮文本', { value: 'Original button' }),
  control(1, 'text', '链接网址 域名 邮箱地址', { value: 'mailto:test@example.test' }),
  control(2, 'checkbox', '在新窗口打开')];
const categoryControls = () => [...radioPair(0, 'selectGroupWay', ['选择所有产品分类', '选择部分产品分类']),
  control(2, 'checkbox', 'AUTOTEST-Category', { name: 'leafProdGroup', value: 'on', checked: true })];
const starts = (fixture) => fixture.records.filter((entry) => entry.status === 'started');
const latest = (fixture, seq) => fixture.records.findLast((entry) => entry.seq === seq);
function assertRecordedCycles(fixture, settingKey, minimumCycles) {
  const intents = starts(fixture);
  assert.ok(intents.filter((entry) => entry.op === 'set-setting').length >= minimumCycles);
  assert.ok(intents.filter((entry) => entry.op === 'restore').length >= minimumCycles);
  for (const entry of intents) {
    assert.equal(entry.restore.kind, 'set-setting');
    assert.equal(entry.restore.settingKey, settingKey);
    assert.deepEqual(entry.target, { siteHost: 'en.example.test:8443', language: '英语', pageId: '42',
      pageKind: 'custom', blockId: '47748', instanceId: 'instance-1' });
    assert.equal(latest(fixture, entry.seq).status, 'done', `operation ${entry.seq} must be confirmed`);
  }
  // Every first setter in a transaction follows the durable intent.
  let intentSinceTerminal = false;
  for (const event of fixture.events) {
    if (event.kind === 'log') intentSinceTerminal = true;
    if (['set', 'scheme', 'color', 'link-tab'].includes(event.kind)) assert.ok(intentSinceTerminal, 'WAL must precede the setter');
    if (['done', 'failed'].includes(event.kind)) intentSinceTerminal = false;
  }
}

for (const [name, controls, cycles] of [
  ['product-list-display', listControls, 5], ['custom-filter-fields', filterControls, 6],
  ['block-color-scheme', () => [], 1], ['button-link', buttonControls, 3],
  ['product-category-select', categoryControls, 1], // mock 只触发 radioPersist 单路径；实现含 3 处 journal 调用
]) {
  test(`${name}: settings entry journals every independent flip/restore and preserves no-journal behavior`, async (t) => {
    const fixture = await capabilityFixture(t, name, controls());
    if (name === 'block-color-scheme') fixture.config.deferFront = false;
    if (name === 'product-category-select') fixture.config.checkGroup = 'pcs-persistence';
    const initial = fixture.controls();
    const checks = await fixture.module.runSettingsLayer(fixture.args);
    assertRecordedCycles(fixture, name, cycles);
    assert.deepEqual(fixture.controls(), initial);
    if (name === 'block-color-scheme') assert.equal(fixture.scheme(), '#1C4587');
    const withJournalEvents = fixture.events.filter((event) => !['log', 'done', 'failed', 'identity', 'read'].includes(event.kind));
    fixture.events.length = 0; fixture.records.length = 0;
    delete fixture.config.mutationJournal;
    const plainChecks = await fixture.module.runSettingsLayer(fixture.args);
    assert.deepEqual(plainChecks, checks);
    assert.deepEqual(fixture.events.filter((event) => !['read', 'identity'].includes(event.kind)), withJournalEvents);
    assert.deepEqual(fixture.records, []);
    assert.deepEqual(fixture.controls(), initial);
  });

  test(`${name}: mutationTarget retains page fallback and refuses ambiguous/missing instance IDs`, async (t) => {
    for (const wraps of [[], [{ attributes: [], querySelectorAll: () => [] }], [
      { attributes: [{ name: 'settingid', value: 'one' }] }, { attributes: [{ name: 'settingid', value: 'two' }] },
    ]]) {
      const fixture = await capabilityFixture(t, name, [], { wraps });
      delete fixture.config.pageId; delete fixture.config.resolvedTarget;
      const target = await fixture.module.mutationTarget(fixture.canvas, fixture.config, fixture.profile);
      assert.equal(target.instanceId, null);
      assert.equal(target.pageId, 'fallback'); assert.equal(target.pageKind, 'system');
    }
    const fixture = await capabilityFixture(t, name, [], { wraps: [{ attributes: [], querySelectorAll: () => [
      { attributes: [{ name: 'data-setting-id', value: 'nested-instance' }] },
    ] }] });
    assert.equal((await fixture.module.mutationTarget(fixture.canvas, fixture.config, fixture.profile)).instanceId, 'nested-instance');
  });
}
