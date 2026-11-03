import fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

/** @typedef {null|boolean|number|string|JsonValue[]|Object<string, JsonValue>} JsonValue */
/**
 * @typedef {Object} MutationTarget
 * @property {string} siteHost Normalized site host, including any port.
 * @property {string|null} language Editor language.
 * @property {string|null} pageId Stable page identity; null when unavailable.
 * @property {string|null} pageKind System/custom page kind.
 * @property {string} blockId Block type identity.
 * @property {string|null} instanceId Instance setting ID; null when unavailable.
 */
/**
 * @typedef {Object} MutationEntry
 * @property {string} runId Report run identity.
 * @property {number} seq Monotonically increasing operation sequence.
 * @property {'set-setting'|'save-page'|'publish'|'delete-instance'|'restore'} op Operation kind.
 * @property {MutationTarget} target Exact known target identity.
 * @property {JsonValue} before Snapshot before the operation.
 * @property {JsonValue} after Intended state after the operation.
 * @property {JsonValue} restore Serializable recovery instructions, never callbacks.
 * @property {'started'|'done'|'failed'|'reverted'} status Latest operation state.
 * @property {string} ts ISO timestamp of this record.
 * @property {string} [error] Failure message.
 */
/**
 * @typedef {Object} Journal
 * @property {string} runId Report run identity.
 * @property {string} path Absolute JSONL filename.
 * @property {number} nextSeq Next sequence at the last operation on this handle.
 */

// Serialize appends and sequence allocation across handles in this process.
// Multiple processes writing the same run require an external ownership lock.
const queues = new Map();

/** @returns {string} The configured, absolute journal directory. */
function journalDirectory() {
  return path.resolve(process.env.JOURNAL_DIR || path.join(homedir(), '.cache', 'block-general-tests', 'journals'));
}

/** @param {string} runId Run identity. @returns {string} Safe JSONL path. */
function journalPath(runId) {
  if (typeof runId !== 'string' || !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(runId)) {
    throw new Error('Invalid mutation journal runId.');
  }
  return path.join(journalDirectory(), `${runId}.jsonl`);
}

/**
 * Run a filesystem operation exclusively for one journal in this process.
 * @template T
 * @param {string} file Journal path.
 * @param {() => Promise<T>} operation Work to serialize.
 * @returns {Promise<T>} Operation result; failures do not poison later work.
 */
async function exclusive(file, operation) {
  const previous = queues.get(file) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  queues.set(file, current);
  try { return await current; }
  finally { if (queues.get(file) === current) queues.delete(file); }
}

/**
 * Read durable rows, ignoring only an incomplete final line left by a crash.
 * Complete malformed lines fail closed instead of concealing pending writes.
 * @param {string} file JSONL path.
 * @returns {Promise<{entries: MutationEntry[], bytes: number}>} Rows and complete-prefix byte length.
 */
async function readRows(file) {
  let source;
  try { source = await fs.readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return { entries: [], bytes: 0 }; throw error; }
  const end = source.lastIndexOf('\n') + 1;
  const complete = source.slice(0, end);
  const entries = complete.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return { entries, bytes: Buffer.byteLength(complete) };
}

/**
 * Fold append-only status updates without losing the original operation data.
 * @param {MutationEntry[]} entries Journal rows.
 * @returns {Map<number, MutationEntry>} Latest state indexed by sequence.
 */
function fold(entries) {
  const latest = new Map();
  for (const entry of entries) latest.set(entry.seq, { ...latest.get(entry.seq), ...entry });
  return latest;
}

/** @param {MutationEntry[]} entries Journal rows. @returns {number} Next unused sequence. */
function nextSequence(entries) {
  return entries.reduce((highest, entry) => Math.max(highest, entry.seq), 0) + 1;
}

/**
 * Reject values JSON would silently discard or coerce, including callbacks.
 * @param {unknown} value Candidate JSON data.
 * @returns {string} Lossless JSON representation.
 */
function serialize(value) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'function' || typeof item === 'symbol' || typeof item === 'undefined'
      || typeof item === 'bigint' || (typeof item === 'number' && !Number.isFinite(item))) {
      throw new TypeError('Mutation journal entries must contain only JSON-serializable data.');
    }
    if (item && typeof item === 'object' && !Array.isArray(item)
      && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new TypeError('Mutation journal entries must contain plain JSON objects.');
    }
    return item;
  });
}

/**
 * Append and fsync one row. Discard an incomplete crash tail before appending.
 * The caller must hold the per-path queue.
 * @param {string} file Journal path.
 * @param {MutationEntry} entry Record to persist.
 * @returns {Promise<void>} Resolves only after the record is durable.
 */
async function appendRow(file, entry) {
  const line = `${serialize(entry)}\n`;
  const { bytes } = await readRows(file);
  const handle = await fs.open(file, 'a', 0o600);
  try {
    await handle.truncate(bytes);
    await handle.writeFile(line, 'utf8');
    await handle.sync();
  } finally { await handle.close(); }
}

/**
 * Open/create a WAL journal; existing records determine the next sequence.
 * Fsync the file and directory so creation is durable too. No open fd is retained.
 * @param {string} runId Existing report run identity.
 * @returns {Promise<Journal>} Handle used by mutation writers.
 */
export async function openJournal(runId) {
  const file = journalPath(runId);
  return exclusive(file, async () => {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const handle = await fs.open(file, 'a', 0o600);
    try { await handle.sync(); } finally { await handle.close(); }
    const directory = await fs.open(path.dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    const { entries } = await readRows(file);
    return { runId, path: file, nextSeq: nextSequence(entries) };
  });
}

/**
 * Persist the intent BEFORE the caller performs any site write (WAL).
 * Callers must abort the site write if this function rejects.
 * @param {Journal} journal Open handle.
 * @param {Pick<MutationEntry, 'op'|'target'|'before'|'after'|'restore'>} entry Serializable intent.
 * @returns {Promise<number>} Allocated and durably recorded sequence.
 */
export async function logMutation(journal, entry) {
  return exclusive(journal.path, async () => {
    const { entries } = await readRows(journal.path);
    const seq = nextSequence(entries);
    await appendRow(journal.path, { ...entry, runId: journal.runId, seq, status: 'started', ts: new Date().toISOString() });
    journal.nextSeq = seq + 1;
    return seq;
  });
}

/**
 * Append a terminal state, preserving all intent fields.
 * @param {Journal} journal Open handle.
 * @param {number} seq Existing mutation sequence.
 * @param {'done'|'failed'|'reverted'} status New state.
 * @param {unknown} [error] Optional failure.
 * @returns {Promise<void>} Durable status update.
 */
async function markStatus(journal, seq, status, error) {
  return exclusive(journal.path, async () => {
    const entry = fold((await readRows(journal.path)).entries).get(seq);
    if (!entry) throw new Error(`Unknown mutation journal sequence: ${seq}`);
    await appendRow(journal.path, { ...entry, status, ts: new Date().toISOString(),
      ...(error === undefined ? {} : { error: error instanceof Error ? error.message : String(error) }) });
  });
}

/**
 * Record that a write was confirmed; this does not claim the original state was restored.
 * @param {Journal} journal Open handle.
 * @param {number} seq Confirmed mutation sequence.
 * @returns {Promise<void>} Durable status update.
 */
export async function markDone(journal, seq) { await markStatus(journal, seq, 'done'); }

/**
 * Record a failed attempt. Failed operations remain evidence but are not pending.
 * @param {Journal} journal Open handle.
 * @param {number} seq Failed mutation sequence.
 * @param {unknown} error Failure to record.
 * @returns {Promise<void>} Durable status update.
 */
export async function markFailed(journal, seq, error) { await markStatus(journal, seq, 'failed', error); }

/**
 * Return started operations with no later done/failed/reverted record, in sequence order.
 * @param {string} runId Report run identity.
 * @returns {Promise<MutationEntry[]>} Pending intents; absent files yield an empty list.
 */
export async function getPendingMutations(runId) {
  const file = journalPath(runId);
  return exclusive(file, async () => [...fold((await readRows(file)).entries).values()]
    .filter((entry) => entry.status === 'started').sort((a, b) => a.seq - b.seq));
}

/**
 * Attempt pending operations in sequence order; never infer recovery from absence of errors.
 * Executor exceptions are recorded as failed and do not stop subsequent operations.
 * Persistence failures propagate, since recovery cannot safely continue without its WAL.
 * @param {string} runId Report run identity.
 * @param {(entry: MutationEntry) => Promise<{recovered: boolean, reason?: string}>} recoverFn Recovery executor.
 * @returns {Promise<{total: number, reverted: number, failed: number, unresolved: Array<{entry: MutationEntry, reason: string}>}>} Counts and unresolved evidence.
 */
export async function recoverFromJournal(runId, recoverFn) {
  const pending = await getPendingMutations(runId);
  const summary = { total: pending.length, reverted: 0, failed: 0, unresolved: [] };
  if (!pending.length) return summary;
  const journal = await openJournal(runId);
  for (const entry of pending) {
    let outcome;
    try { outcome = await recoverFn(entry); }
    catch (error) {
      await markFailed(journal, entry.seq, error);
      summary.failed += 1;
      continue;
    }
    if (outcome?.recovered === true) {
      await markStatus(journal, entry.seq, 'reverted');
      summary.reverted += 1;
    } else {
      summary.unresolved.push({ entry, reason: outcome?.reason || 'recovery-not-confirmed' });
    }
  }
  return summary;
}

/**
 * Scan durable journals for pending work, in stable runId order.
 * @returns {Promise<string[]>} Run identities needing recovery; missing directories yield [].
 */
export async function findPendingJournals() {
  let files;
  try { files = await fs.readdir(journalDirectory(), { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const pending = [];
  for (const file of files.filter((item) => item.isFile() && item.name.endsWith('.jsonl')).sort((a, b) => a.name.localeCompare(b.name))) {
    const runId = file.name.slice(0, -6);
    if ((await getPendingMutations(runId)).length) pending.push(runId);
  }
  return pending;
}
