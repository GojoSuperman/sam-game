/**
 * SAM 키 선택.
 *
 * 이 프로젝트는 역할별 키를 여러 개 둔다 (SAM_KEY_MASTER / SAC / CHAT / SPUM).
 * 어느 키를 쓸지는 아래 우선순위로 정한다:
 *
 *   1. 호출부가 명시한 키 (함수 인자)
 *   2. SAM_API_KEY            — 단일 키만 쓰는 환경 호환용
 *   3. SAM_KEY_<SAM_KEY_ROLE> — .env.local 의 SAM_KEY_ROLE 이 고른 역할
 *   4. SPUM -> CHAT -> SAC -> MASTER 순 폴백
 *
 * master 키를 마지막에 두는 이유: SAM 문서상 master 는 자동 생성되고 폐기가
 * 불가능하다. 유출 시 회전할 수 없으므로 앱/서버 연동의 기본값으로 삼지 않는다.
 */

export const KEY_ROLES = Object.freeze(['SPUM', 'CHAT', 'SAC', 'MASTER']);

const clean = (v) => String(v ?? '').trim();

/** 로그·에러 메시지에 안전하게 쓸 마스킹 형태. 절대 원문을 노출하지 않는다. */
export function maskKey(key) {
  const k = clean(key);
  if (!k) return '(없음)';
  return `${k.slice(0, 8)}…[${k.length}자]`;
}

/** 환경에 실제로 들어 있는 역할 목록 */
export function availableRoles(env = process.env) {
  return KEY_ROLES.filter((r) => clean(env[`SAM_KEY_${r}`]));
}

/**
 * @returns {{ key: string, role: string, source: string }}
 * @throws 키를 하나도 못 찾으면 어디에 무엇을 넣어야 하는지 알려주며 실패한다.
 */
export function resolveKey({ key = '', role = '', env = process.env } = {}) {
  const explicit = clean(key);
  if (explicit) return { key: explicit, role: 'explicit', source: '호출부 인자' };

  const single = clean(env.SAM_API_KEY);
  if (single && !single.includes('xxxx')) {
    return { key: single, role: 'SAM_API_KEY', source: 'SAM_API_KEY' };
  }

  const wanted = clean(role || env.SAM_KEY_ROLE).toUpperCase();
  if (wanted) {
    const v = clean(env[`SAM_KEY_${wanted}`]);
    if (v) return { key: v, role: wanted, source: `SAM_KEY_${wanted} (SAM_KEY_ROLE)` };
    const have = availableRoles(env);
    throw new Error(
      `SAM_KEY_ROLE=${wanted} 인데 SAM_KEY_${wanted} 가 비어 있습니다.`
      + (have.length ? ` 사용 가능한 역할: ${have.join(', ')}` : ' .env.local 에 키가 하나도 없습니다.'),
    );
  }

  for (const r of KEY_ROLES) {
    const v = clean(env[`SAM_KEY_${r}`]);
    if (v) return { key: v, role: r, source: `SAM_KEY_${r} (폴백)` };
  }

  throw new Error(
    'SAM 키를 찾을 수 없습니다. .env.local 에 다음 중 하나를 넣으세요:\n'
    + KEY_ROLES.map((r) => `  SAM_KEY_${r}=sam-...`).join('\n')
    + '\n또는 SAM_API_KEY=sam-... (단일 키)',
  );
}
