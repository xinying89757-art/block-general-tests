import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

const VALID_STATUSES = new Set(['approved', 'pending-business', 'pending-data']);

function loadProfile(id) {
  return JSON.parse(readFileSync(path.join(root, `profiles/${id}.json`), 'utf8'));
}

test('47498/47368 的能力 reviewStatus 均为 pending-business（未审核前不得标 approved）', () => {
  for (const id of ['47498', '47368']) {
    const p = loadProfile(id);
    const caps = p.requirements?.capabilities ?? [];
    assert.ok(caps.length > 0, `${id} 应有 capabilities`);
    for (const cap of caps) {
      const status = cap.reviewStatus ?? 'pending-business';
      assert.ok(
        VALID_STATUSES.has(status),
        `${id} capability ${cap.id} 的 reviewStatus 非法: ${status}`,
      );
      assert.notEqual(status, 'approved', `${id} 尚未审核，capability ${cap.id} 不得标 approved`);
    }
  }
});

test('reviewStatus 缺省视为 pending-business', () => {
  // 40838/47748 未显式标记时，validate-profiles 应按 pending-business 统计
  const p = loadProfile('40838');
  const caps = p.requirements?.capabilities ?? [];
  for (const cap of caps) {
    const status = cap.reviewStatus ?? 'pending-business';
    assert.ok(VALID_STATUSES.has(status), `40838 capability ${cap.id} 状态非法`);
  }
});

test('TEMPLATE.json 包含 reviewStatus 说明', () => {
  const raw = readFileSync(path.join(root, 'profiles/TEMPLATE.json'), 'utf8');
  assert.match(raw, /reviewStatus/);
});
