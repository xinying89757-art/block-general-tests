import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAllowedLinkUrl, isAllowedLinkUrl, normalizeLinkUrl } from '../src/url-safety.mjs';
import { diffAgainstBaseline, isGarbledUrl } from '../src/baseline-guard.mjs';
import { redact } from '../src/run.mjs';
import { buttonMatchesTargetExpectation } from '../src/capabilities/button-link.mjs';

test('link writes allow complete URLs and supported special targets only', () => {
  for (const value of ['https://www.baidu.com/', 'http://example.test/path?q=1', 'javascript:void(0)', 'javascript:void(0);', 'mailto:test@example.com']) {
    assert.equal(isAllowedLinkUrl(value), true);
    assert.doesNotThrow(() => assertAllowedLinkUrl(value));
  }
  assert.equal(normalizeLinkUrl('javascript:void(0);'), 'javascript:void(0)');
  assert.equal(assertAllowedLinkUrl('javascript:void(0);'), 'javascript:void(0);');
  for (const value of ['https://example.com 中文', 'https://example.com，更多说明', 'not a url', 'javascript:alert(1)', 'mailto:bad']) {
    assert.equal(isAllowedLinkUrl(value), false);
    assert.throws(() => assertAllowedLinkUrl(value), /拒绝写入/);
  }
});

test('garbled URL detection emits a dedicated baseline residue reason', () => {
  const baseline = [{ type: 'button', want: [{ label: '链接网址', type: 'text', to: 'javascript:void(0)' }] }];
  const current = [{ type: 'button', want: [{ label: '链接网址', type: 'text', to: 'https://example.com，说明' }] }];
  assert.equal(isGarbledUrl(current[0].want[0].to), true);
  assert.equal(diffAgainstBaseline(baseline, current)[0].reason, 'garbled-url');
});

test('URL report redaction stops before Chinese prose punctuation', () => {
  const clean = redact({ actual: '观察地址“https://www.baidu.com”，新开页面。' }, {});
  assert.match(clean.actual, /https:\/\/www\.baidu\.com\//);
  assert.doesNotMatch(clean.actual, /xn--/);
});

test('button target effect assertion requires both exact address and requested window mode', () => {
  assert.equal(buttonMatchesTargetExpectation({ sameAddress: true, newWindow: false }, false), true);
  assert.equal(buttonMatchesTargetExpectation({ sameAddress: false, newWindow: false }, false), false);
  assert.equal(buttonMatchesTargetExpectation({ sameAddress: true, newWindow: true }, false), false);
});
