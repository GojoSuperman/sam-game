/**
 * SPUM 월드 런타임 ↔ SAM 모델 alias 변환.
 *
 * 왜 필요한가:
 *   SPUM 월드 런타임(WorldLLMModels.js)은 모델을 'light' | 'medium' | 'expert'
 *   세 티어 이름으로만 보낸다. 이 이름들은 SAM 의 실제 alias 가 아니다.
 *   (GET /v1/models 로 확인: light/medium/expert 는 존재하지 않는 alias)
 *   spum.soonsoon.ai 의 /api/sam 프록시가 서버측에서 실제 모델로 바꿔주기 때문에
 *   Studio 안에서는 그냥 동작한다. 우리가 프록시를 직접 띄우면 이 변환을
 *   반드시 우리가 해야 한다. 안 하면 404 MODEL_NOT_FOUND.
 *
 * 티어 선정 근거 (2026-08-18 GET /v1/models 실측: avg_latency_ms, $/1M):
 *   light  : 말풍선 잡담 — 지연이 체감 품질을 지배하므로 최저 지연·최저가
 *   medium : 기본 대화 — 캐릭터 연기와 지시 준수의 균형
 *   expert : 미션 설계/판정, 행동 결정 — 구조화 JSON 정확도가 중요
 */

/** SPUM 티어 → SAM 실제 alias */
export const TIER_TO_ALIAS = Object.freeze({
  // 400ms / $0.06·$0.40 — 최저가. 배경 NPC 잡담·생각 말풍선용.
  light: 'glm-4.7-flash',
  // 600ms / $1.10·$5.50 — thinking 지원. 주요 캐릭터 대화 기본값.
  medium: 'claude-haiku',
  // 1200ms / $3.30·$16.50 — 미션 설계·행동 커맨드 JSON 등 정확도 우선.
  expert: 'claude-sonnet-4.6',
});

/** 지연을 더 짜야 할 때 쓰는 대안 프리셋. SAM_TIER_PRESET 로 선택. */
export const TIER_PRESETS = Object.freeze({
  balanced: TIER_TO_ALIAS,
  // 비용 우선 프리셋. 여기서 단조 증가하는 축은 '지연' 이 아니라 '가격' 이다.
  // light 400ms / medium 350ms 로 지연이 살짝 역전되지만 둘 다 0.4초 이하라
  // 체감 차이가 없고, 이 프리셋의 목적은 토큰 단가를 낮추는 것이다.
  // (gemma-3-4b 가 토큰당 최저가지만 1500ms 라 말풍선용으로는 부적합해서 뺐다.)
  cheap: Object.freeze({
    light: 'glm-4.7-flash',         //  400ms / $0.06·$0.40
    medium: 'az-deepseek-v4-flash', //  350ms / $0.19·$0.51
    expert: 'az-deepseek-v4-pro',   // 1200ms / $1.74·$3.48
  }),
  snappy: Object.freeze({
    light: 'gpt-5.4-nano',        //  280ms — 실측 최속
    medium: 'az-deepseek-v4-flash', // 350ms / $0.19·$0.51
    expert: 'claude-haiku',       //  600ms
  }),
});

export const IMAGE_MODEL_DEFAULT = 'gpt-image-1-mini'; // $0.011/장

/**
 * SPUM 이 보낸 model 값을 SAM alias 로 바꾼다.
 * 이미 실제 alias 라면 그대로 통과시킨다 (직접 호출도 지원하기 위함).
 */
export function resolveModel(model, presetName = 'balanced') {
  const raw = String(model ?? '').trim();
  const table = TIER_PRESETS[presetName] || TIER_PRESETS.balanced;
  if (!raw) return table.medium;
  return table[raw] || raw;
}

/** 프록시 로그용 — 변환이 실제로 일어났는지 표시 */
export function describeResolution(model, presetName = 'balanced') {
  const from = String(model ?? '').trim() || '(empty)';
  const to = resolveModel(model, presetName);
  return from === to ? to : `${from} -> ${to}`;
}
