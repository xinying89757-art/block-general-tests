import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyExternalFrontStyleReport, applyExternalFrontVerification } from '../src/external-front-verification.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [reportArg, resultArg] = process.argv.slice(2);
if (!reportArg || !resultArg) {
  console.error('Usage: node scripts/ingest-external-front-verification.mjs <report.json> <external-check.json>');
  process.exitCode = 2;
} else {
  const reportPath = path.resolve(reportArg);
  const resultPath = path.resolve(resultArg);
  const [report, result] = await Promise.all([
    fs.readFile(reportPath, 'utf8').then(JSON.parse),
    fs.readFile(resultPath, 'utf8').then(JSON.parse),
  ]);
  const updated = result?.flow === 'front-style-only'
    ? applyExternalFrontStyleReport(report, result, resultArg)
    : applyExternalFrontVerification(report, result);
  await fs.writeFile(reportPath, `${JSON.stringify(updated, null, 2)}\n`);
  if (updated.externalFrontStyleReport) {
    const { pass, fail, na } = updated.externalFrontStyleReport.summary;
    console.log(`[external-front] ${path.relative(root, reportPath)} style pass=${pass} fail=${fail} na=${na}`);
  } else console.log(`[external-front] ${path.relative(root, reportPath)} confirmed=${updated.externalFrontVerification.confirmed}`);
}
