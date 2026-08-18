#!/usr/bin/env node
/**
 * 티어 프리셋 정합성 검사 (키 불필요 — GET /v1/models 는 공개).
 *   - 모든 alias 가 SAM 에 실제로 존재하는가
 *   - 프리셋의 의도대로 단조 증가하는가
 *     balanced/snappy = 지연 기준, cheap = 출력 단가 기준
 *   - 'light'/'medium'/'expert' 가 SAM alias 로 존재하지 않는가 (변환 필요 전제)
 */
import { listModels } from '../src/sam.mjs';
import { TIER_PRESETS } from '../src/tiers.mjs';

const MONOTONIC_AXIS = { balanced: 'latency', snappy: 'latency', cheap: 'cost' };
const by = new Map((await listModels()).models.map((m) => [m.alias, m]));
let bad = 0;

for (const [preset, table] of Object.entries(TIER_PRESETS)) {
  const axis = MONOTONIC_AXIS[preset] || 'latency';
  const rows = ['light', 'medium', 'expert'].map((t) => {
    const alias = table[t];
    const m = by.get(alias);
    if (!m) { console.log(`  ${preset}/${t} -> ${alias}  << SAM 에 없는 alias >>`); bad += 1; return null; }
    return { t, alias, latency: m.avg_latency_ms ?? Infinity, cost: m.pricing?.output_per_1m ?? Infinity };
  });
  if (rows.some((r) => !r)) continue;
  const v = rows.map((r) => r[axis]);
  const ok = v[0] <= v[1] && v[1] <= v[2];
  if (!ok) bad += 1;
  console.log(
    `${preset.padEnd(9)} [${axis}] `
    + rows.map((r) => `${r.t}=${axis === 'latency' ? `${r.latency}ms` : `$${r.cost}`}`).join('  ')
    + (ok ? '  OK' : '  << 단조성 위반 >>'),
  );
}

const leaked = ['light', 'medium', 'expert'].filter((t) => by.has(t));
if (leaked.length) { console.log(`\n티어 이름이 실제 alias 로 존재: ${leaked.join(', ')} — 변환 전제 재검토 필요`); bad += 1; }
else console.log("\nOK: 'light'/'medium'/'expert' 는 SAM alias 가 아님 — 프록시 변환이 필수라는 전제 확인");

process.exit(bad ? 1 : 0);
