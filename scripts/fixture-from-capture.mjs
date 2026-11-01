#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fixtureFromCapture } from '../src/capture-fixture.mjs';

export async function writeCaptureFixtures(capturePath, outputDirectory, { replayObservations = true } = {}) {
  const source = path.resolve(capturePath), stat = await fs.stat(source);
  const files = stat.isDirectory() ? (await fs.readdir(source)).filter((name) => /^(pc|mobile)\.json$/.test(name)).map((name) => path.join(source, name)) : [source];
  if (!files.length) throw new Error('No pc.json or mobile.json capture was found.');
  const destination = path.resolve(outputDirectory);
  if (destination === source || files.some((file) => path.dirname(file) === destination)) throw new Error('Fixture output must not overwrite the capture directory.');
  await fs.mkdir(destination, { recursive: true });
  const outputs = [];
  for (const file of files) {
    const input = await fs.readFile(file, 'utf8');
    const capture = JSON.parse(input);
    const label = capture.viewport?.label === 'mobile' ? 'mobile' : 'pc';
    const result = fixtureFromCapture(capture, { cssFile: `${label}.css`, replayObservations });
    await Promise.all([fs.writeFile(path.join(destination, `${label}.html`), result.html), fs.writeFile(path.join(destination, `${label}.css`), result.css)]);
    outputs.push({ replayObservations, sourceCapture: path.basename(file), sourceSha256: createHash('sha256').update(input).digest('hex'), viewport: result.viewport, html: `${label}.html`, css: `${label}.css`, elementCount: result.elementCount, limitations: result.limitations });
  }
  await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify({ source: path.basename(source), outputs }, null, 2));
  return outputs;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), positional = [];
  let source, output, replayObservations = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--replay-observations') replayObservations = args[++i] === '1';
    else if (args[i] === '--capture') source = args[++i];
    else if (args[i] === '--out') output = args[++i];
    else positional.push(args[i]);
  }
  source ||= positional[0]; output ||= positional[1];
  if (!source || !output) { console.error('Usage: node scripts/fixture-from-capture.mjs <capture-dir-or-json> <fixture-output-dir>'); process.exitCode = 2; }
  else try { const rows = await writeCaptureFixtures(source, output, { replayObservations }); console.log(`Offline fixtures written: ${rows.map((row) => row.html).join(', ')}`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
