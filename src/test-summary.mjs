export function parseTapSummary(output) {
  const read = (label) => {
    const match = output.match(new RegExp(`^# ${label} (\\d+)$`, 'm'));
    return match ? Number(match[1]) : null;
  };
  const summary = { tests: read('tests'), pass: read('pass'), fail: read('fail'), cancelled: read('cancelled'), skipped: read('skipped') };
  if (Object.values(summary).some((value) => value === null)) throw new Error('Node test TAP summary is incomplete.');
  return summary;
}

export function assertNoCancelledTests(summary) {
  if (summary.cancelled !== 0) throw new Error(`CI rejects cancelled tests: ${summary.cancelled} cancelled.`);
}
