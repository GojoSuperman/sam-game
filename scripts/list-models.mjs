#!/usr/bin/env node
/** GET /v1/models 를 게임 관점(지연·가격)으로 정렬해서 보여준다. */
import { listModels } from '../src/sam.mjs';

const onlyImage = process.argv.includes('--image');
const { models, count } = await listModels();

const rows = models
  .filter((m) => (onlyImage ? m.pricing?.image_per_unit != null : m.pricing?.image_per_unit == null))
  .sort((a, b) => (a.avg_latency_ms || 1e9) - (b.avg_latency_ms || 1e9));

console.log(`\n총 ${count}개 중 ${rows.length}개 (${onlyImage ? '이미지' : '텍스트'}) — 지연 낮은 순\n`);
const pad = (s, n) => String(s ?? '').padEnd(n);
console.log(pad('alias', 26) + pad('provider', 20) + pad('지연', 9) + (onlyImage ? '$/장' : '입력$/1M   출력$/1M'));
console.log('-'.repeat(84));
for (const m of rows) {
  const p = m.pricing || {};
  const cost = onlyImage
    ? `${p.image_per_unit}`
    : `${pad(p.input_per_1m, 11)}${p.output_per_1m}`;
  console.log(pad(m.alias, 26) + pad(m.provider, 20) + pad(`${m.avg_latency_ms ?? '?'}ms`, 9) + cost);
}
console.log('');
