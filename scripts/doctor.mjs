#!/usr/bin/env node
/**
 * SAM / SPUM 상태 진단.
 *
 *   pnpm doctor
 *
 * 무엇이 막혀 있는지 한 번에 좁힌다. 각 프로브는 독립이므로 병렬로 던지고,
 * 프로브별 상한을 둬서 전체가 몇 초 안에 끝나게 한다.
 * (SAM 의 계정 초기화 실패는 30초, /v1/hello 는 180초까지 걸린 실측이 있다.)
 *
 * 읽는 축:
 *   - 공개 엔드포인트(/v1/models)만 되면 -> 네트워크는 정상, 계정 문제
 *   - 키를 바꿔도 같으면 -> 키 문제 아님, 계정 레벨
 *   - 표면(native/openai/anthropic)을 바꿔도 같으면 -> 표면 문제 아님
 *   - /v1/spum/access 가 되면 -> 인증 레이어는 정상
 */
import { SAM_BASE } from '../src/sam.mjs';
import { KEY_ROLES, availableRoles, maskKey } from '../src/keys.mjs';

const PROBE_TIMEOUT_MS = Number(process.env.DOCTOR_TIMEOUT_MS || 35000);

async function probe(label, path, { method = 'GET', body = null, headers = {} } = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${SAM_BASE}${path}`, {
      method,
      headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const text = await res.text().catch(() => '');
    let note = '';
    if (res.ok) {
      note = `(${text.length}B)`;
    } else {
      try {
        const j = JSON.parse(text);
        note = j.detail || j.error?.code || j.error?.message || '';
      } catch { note = text.startsWith('<') ? 'HTML 오류 페이지' : text.slice(0, 60); }
    }
    return { label, status: res.status, ms: Date.now() - t0, note: String(note).slice(0, 48), body: res.ok ? text : '' };
  } catch (err) {
    const to = err?.name === 'TimeoutError';
    return { label, status: to ? 'TIMEOUT' : 'ERR', ms: Date.now() - t0, note: to ? `>${PROBE_TIMEOUT_MS}ms` : String(err.message).slice(0, 48), body: '' };
  }
}

const roles = availableRoles();
if (!roles.length) { console.error('.env.local 에 SAM_KEY_<역할> 키가 없습니다.'); process.exit(1); }
const primary = process.env.SAM_KEY_SPUM || process.env[`SAM_KEY_${roles[0]}`];
const K = (k) => ({ 'X-API-Key': k });
const genBody = (model) => JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], options: { stream: false, max_tokens: 8 } });

console.log(`\n=== SAM / SPUM 진단 ===  (프로브 상한 ${PROBE_TIMEOUT_MS}ms)\n`);
console.log(`보유 키: ${roles.map((r) => `${r}=${maskKey(process.env[`SAM_KEY_${r}`])}`).join('  ')}\n`);

// 읽기 프로브는 병렬로도 안전하지만, 생성 프로브는 순차로 던진다.
// 실측: 14개를 동시에 던지면 503 이 엔드포인트별로 무작위로 옮겨 다닌다 —
// 계정 초기화 경로에 락이 있어 스스로 경합을 만드는 것으로 보인다.
const readProbes = [
  probe('공개  GET /v1/models', '/v1/models'),
  probe('인증  GET /v1/spum/access', '/v1/spum/access', { headers: K(primary) }),
  probe('계정  GET /v1/account', '/v1/account', { headers: K(primary) }),
  probe('SPUM  GET /v1/spum/api-catalog', '/v1/spum/api-catalog', { headers: K(primary) }),
  probe('SPUM  GET /v1/spum/context', '/v1/spum/context', { headers: K(primary) }),
  probe('SPUM  GET /v1/spum/credits', '/v1/spum/credits', { headers: K(primary) }),
  probe('SPUM  GET /v1/spum/modules', '/v1/spum/modules', { headers: K(primary) }),
];

const writeProbeDefs = [
  ...KEY_ROLES.filter((r) => process.env[`SAM_KEY_${r}`]).map((r) => () => probe(
    `생성  POST /v1/generate [${r}]`, '/v1/generate',
    { method: 'POST', body: genBody('glm-4.7-flash'), headers: K(process.env[`SAM_KEY_${r}`]) },
  )),
  () => probe('호환  POST /openai/v1/chat/completions', '/openai/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ model: 'glm-4.7-flash', messages: [{ role: 'user', content: 'hi' }], max_tokens: 8 }),
    headers: { Authorization: `Bearer ${primary}` },
  }),
  () => probe('호환  POST /v1/messages', '/v1/messages', {
    method: 'POST',
    body: JSON.stringify({ model: 'claude-haiku', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] }),
    headers: { 'x-api-key': primary, 'anthropic-version': '2023-06-01' },
  }),
];

const rows = await Promise.all(readProbes);
for (const make of writeProbeDefs) rows.push(await make()); // 순차
const W = Math.max(...rows.map((r) => r.label.length)) + 2;
console.log(`${'프로브'.padEnd(W)}${'상태'.padEnd(9)}${'소요'.padEnd(10)}비고`);
console.log('-'.repeat(W + 9 + 10 + 30));
for (const r of rows) {
  const c = r.status === 200 ? '\x1b[32m' : '\x1b[31m';
  console.log(`${r.label.padEnd(W)}${c}${String(r.status).padEnd(9)}\x1b[0m${`${r.ms}ms`.padEnd(10)}${r.note}`);
}

// SPUM 권한 요약 — 게임 제작 가능 범위를 결정한다
const access = rows.find((r) => r.label.includes('spum/access'));
if (access?.body) {
  try {
    const cap = JSON.parse(access.body).access;
    console.log('\n--- SPUM 권한 ---');
    console.log(`  membership      ${cap.membership} (tier=${cap.capabilities?.tier})`);
    console.log(`  credits         ${cap.credits}`);
    const c = cap.capabilities || {};
    console.log(`  canUseAI        ${c.canUseAI}${c.canUseAI === false ? '   <- Studio 안 AI 기능 불가 (레인 A 차단)' : ''}`);
    console.log(`  maxWorlds       ${c.maxWorlds}`);
    console.log(`  maxCastPerWorld ${c.maxCastPerWorld}`);
    console.log(`  world           create=${c.canCreateWorld} edit=${c.canEditWorld} delete=${c.canDeleteWorld}`);
  } catch { /* 형식이 바뀌면 표만 보고 판단 */ }
}

// --- 진단 ---
const gen = rows.filter((r) => r.label.startsWith('생성') || r.label.startsWith('호환'));
const genOk = gen.filter((r) => r.status === 200).length;
const initRows = rows.filter((r) => /account initialization/i.test(r.note));
const slowRows = rows.filter((r) => r.status === 'TIMEOUT' || r.ms > 25000);
const anyAuthOk = rows.some((r) => r.status === 200 && r.label !== '공개  GET /v1/models');

console.log('\n--- 진단 ---');
if (rows[0].status !== 200) {
  console.log('  네트워크 또는 SAM 자체가 응답하지 않습니다.');
} else if (genOk === gen.length) {
  console.log('  생성 호출 정상. `pnpm verify` 로 전체 기능을 확인하세요.');
} else if (initRows.length || slowRows.length) {
  console.log(`  \x1b[33m원인: SAM 서버측 계정 초기화 미완료\x1b[0m — "Account initialization is temporarily unavailable" (503).`);
  console.log(`  해당 프로브 ${initRows.length}건, 25초 초과/타임아웃 ${slowRows.length}건.`);
  if (anyAuthOk) console.log('  같은 키로 일부 인증 엔드포인트는 200 이므로 키와 인증 레이어는 정상입니다.');
  console.log('  503 이 엔드포인트별로 옮겨 다니는 것도 관찰됐습니다 (초기화 경로 경합).');
  console.log('  클라이언트에서 고칠 수 없습니다 — SoonSoon 측 계정 프로비저닝이 끝나야 합니다.');
  console.log('  잠시 후 `pnpm doctor` 로 다시 확인하세요.');
} else {
  console.log(`  생성 호출이 ${genOk}/${gen.length} 성공 — 위 표에서 실패 항목의 비고를 확인하세요.`);
}
console.log('');
