import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/capabilities/signatures.mjs', import.meta.url), 'utf8');
if (/40838|47748/.test(source)) throw new Error('能力识别规则不得包含区块 ID。');
console.log('能力识别规则未包含样本区块 ID。');
