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

test('redact scrubs secrets and URL query strings in nested reports but preserves previewLink', () => {
  const config = {
    password: 'fakepw123',
    httpsProxy: 'http://proxy.test:8080',
    editSiteUrl: 'https://editor.test/page?token=secret',
  };
  const report = {
    links: { front: 'https://shop.test/products?token=abc&x=1', editor: 'https://www.leadong.com/pagebuilder?id=42&lanCode=0' },
    previewLink: 'https://shop.test/preview?id=7&token=abc',
    checks: [ { id: 'cap-x', status: 'fail', detail: 'login with fakepw123 failed',
      evidence: { note: 'see https://shop.test/deep?a=1',
        nested: { deep: 'proxy http://proxy.test:8080 in use; editor was https://editor.test/page?token=secret&step=2' } } } ],
    failure: { message: 'boom: fakepw123 at https://shop.test/page?a=1&b=2' },
  };
  const safe = redact(report, config);
  const text = JSON.stringify(safe);
  assert.doesNotMatch(text, /fakepw123/);
  assert.doesNotMatch(text, /proxy\.test:8080/);
  assert.doesNotMatch(text, /editor\.test\/page\?token=secret/);
  assert.equal(safe.links.front, 'https://shop.test/products');
  assert.equal(safe.links.editor, 'https://www.leadong.com/pagebuilder');
  assert.equal(safe.checks[0].evidence.note, 'see https://shop.test/deep');
  assert.equal(safe.checks[0].evidence.nested.deep, 'proxy [redacted] in use; editor was [redacted]&step=2');
  assert.equal(safe.checks[0].detail, 'login with [redacted] failed');
  assert.equal(safe.failure.message, 'boom: [redacted] at https://shop.test/page');
  assert.equal(safe.previewLink, 'https://shop.test/preview?id=7&token=abc');
});

test('redact still replaces secrets inside previewLink while keeping its query string', () => {
  const safe = redact({ previewLink: 'https://shop.test/preview?pw=fakepw123' }, { password: 'fakepw123' });
  assert.equal(safe.previewLink, 'https://shop.test/preview?pw=[redacted]');
});

test('button target effect assertion requires both exact address and requested window mode', () => {
  assert.equal(buttonMatchesTargetExpectation({ sameAddress: true, newWindow: false }, false), true);
  assert.equal(buttonMatchesTargetExpectation({ sameAddress: false, newWindow: false }, false), false);
  assert.equal(buttonMatchesTargetExpectation({ sameAddress: true, newWindow: true }, false), false);
});
