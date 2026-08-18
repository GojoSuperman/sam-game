#!/usr/bin/env node
/**
 * 역할별 SAM 키를 각각 실제로 호출해서 검증한다.
 *
 *   pnpm verify-keys
 *
 * 1) 키마다 GET /v1/account 로 유효성 확인
 * 2) GET /v1/account/keys 로 키별 종류·월 한도·삭제/회전 가능 여부 확인
 * 3) 월 한도가 계정 총액과 같으면 "예산 격리 안 됨" 으로 경고
 *
 * 키 원문은 절대 출력하지 않는다 (maskKey 만 사용).
 */
import { SAM_BASE, getAccount } from '../src/sam.mjs';
import { KEY_ROLES, availableRoles, maskKey, resolveKey } from '../src/keys.mjs';

const roles = availableRoles();
if (!roles.length) {
  console.error('.env.local 에 SAM_KEY_<역할> 형태의 키가 없습니다. (SAM_KEY_SPUM 등)');
  process.exit(1);
}

console.log('\n=== SAM 키 검증 ===\n');

let chosen = null;
try { chosen = resolveKey(); } catch { /* 아래에서 보고 */ }
console.log(chosen ? `기본 선택: ${chosen.role}  (${chosen.source})` : '기본 선택: 실패 — SAM_KEY_ROLE 을 확인하세요');

// --- 1) 키별 유효성 -------------------------------------------------------
let account = null;
const results = [];
console.log('\n[1] 키별 유효성 — GET /v1/account\n');
for (const role of KEY_ROLES) {
  const key = process.env[`SAM_KEY_${role}`];
  if (!key) continue;
  const label = `${role.padEnd(7)} ${maskKey(key).padEnd(18)}`;
  try {
    const t0 = Date.now();
    const json = await getAccount({ key });
    const acct = json.account ?? json; // 실제 응답은 { ok, account: {...} }
    account ??= acct;
    results.push({ role, ok: true, prefix: String(key).slice(0, 12) });
    console.log(`  \x1b[32mOK\x1b[0m   ${label} ${Date.now() - t0}ms`);
  } catch (err) {
    results.push({ role, ok: false, err, prefix: String(key).slice(0, 12) });
    console.log(`  \x1b[31mFAIL\x1b[0m ${label} ${err.code || ''} ${err.message}`);
  }
}

// --- 2) 계정 현황 ---------------------------------------------------------
if (account) {
  console.log('\n[2] 계정 현황\n');
  const row = (k, v) => console.log(`  ${k.padEnd(22)} ${v}`);
  row('플랜', `${account.plan_display_name ?? '?'} (${account.plan_code ?? '?'}, source=${account.plan_source ?? '?'})`);
  row('쌤 잔액', `${account.ssam_remaining ?? '?'} / ${account.ssam_total ?? '?'}  (사용 ${account.ssam_used ?? '?'})`);
  row('USD 환산', `$${account.budget_remaining_usd ?? '?'} / $${account.budget_total_usd ?? '?'}  (환산율 ${account.ssam_rate_per_cost_usd ?? '?'} 쌤/USD)`);
  row('사용 가능 모델', Array.isArray(account.models_available) ? `${account.models_available.length}개` : (account.models_available ?? '?'));
  row('API 키', `${account.api_keys_count ?? '?'} / ${account.api_keys_max ?? '?'}`);
  if (account.coding_agent_access) row('코딩 에이전트', JSON.stringify(account.coding_agent_access));
  if (account.storage_quota_bytes) {
    row('스토리지', `${(Number(account.storage_used_bytes || 0) / 2 ** 30).toFixed(2)} / ${(Number(account.storage_quota_bytes) / 2 ** 30).toFixed(0)} GiB`);
  }
}

// --- 3) 키별 상세 + 예산 격리 여부 ---------------------------------------
const masterKey = process.env.SAM_KEY_MASTER || chosen?.key;
if (masterKey) {
  console.log('\n[3] 키별 상세 — GET /v1/account/keys\n');
  try {
    const res = await fetch(`${SAM_BASE}/v1/account/keys`, { headers: { 'X-API-Key': masterKey } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { keys = [] } = await res.json();
    const head = `  ${'name'.padEnd(13)}${'kind'.padEnd(9)}${'service'.padEnd(9)}${'월한도(쌤)'.padEnd(12)}${'rpm'.padEnd(8)}${'삭제'.padEnd(6)}${'회전'.padEnd(6)}관리형`;
    console.log(head);
    console.log(`  ${'-'.repeat(head.length - 2)}`);
    const total = Number(account?.ssam_total ?? 0);
    let allShared = true;
    for (const k of keys) {
      // .env.local 에 넣은 키와 대조 — key_prefix 로 매칭
      const mine = results.find((r) => String(k.key_prefix || '').startsWith(r.prefix.slice(0, 8)));
      const mark = mine ? ` <- SAM_KEY_${mine.role}` : '';
      const limit = Number(k.monthly_ssam_limit ?? 0);
      if (total && limit !== total) allShared = false;
      console.log(
        `  ${String(k.name).padEnd(13)}${String(k.key_kind).padEnd(9)}${String(k.service_code ?? '-').padEnd(9)}`
        + `${String(limit).padEnd(12)}${String(k.rpm_limit ?? '기본 20').padEnd(8)}`
        + `${String(k.can_delete).padEnd(6)}${String(k.can_regenerate).padEnd(6)}${k.is_system_managed}${mark}`,
      );
    }
    if (allShared && total) {
      console.log(`\n  \x1b[33m경고\x1b[0m 모든 키의 월 한도가 계정 총액(${total} 쌤)과 같습니다 — 예산이 격리되지 않습니다.`);
      console.log('       한 키가 폭주하면 전체 예산을 소진합니다. 프로젝트 비용을 분리하려면');
      console.log('       POST /v1/account/keys 로 monthly_ssam_limit 을 낮춘 custom 키를 따로 발급하세요.');
    }
  } catch (err) {
    console.log(`  조회 실패: ${err.message}`);
  }
}

const ok = results.filter((r) => r.ok).length;
console.log(`\n=== ${ok}/${results.length} 개 키 유효 ===\n`);
process.exit(ok === results.length ? 0 : 1);
