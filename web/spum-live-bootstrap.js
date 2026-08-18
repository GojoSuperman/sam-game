/**
 * SPUM 월드 런타임을 내 프록시로 돌리는 부트스트랩.
 *
 * SPUM 런타임(packages/spum-world/runtime/WorldLLMRuntimeTransport.js)은 매 호출마다
 * globalThis.SPUM_WORLD_LLM_PROXY_URL 을 읽는다. 따라서 런타임보다 먼저 실행되기만
 * 하면 되고, 이미 떠 있는 페이지의 DevTools 콘솔에서 실행해도 즉시 반영된다.
 *
 * 읽는 전역 (그쪽 소스 기준):
 *   SPUM_WORLD_LLM_PROXY_URL   — /v1/generate 를 보낼 절대 URL. 미설정 시 '/api/sam/v1/generate'
 *   SPUM_WORLD_ACCESS_TOKEN    — X-SPUM-WORLD-ACCESS 헤더로 전송 (프록시 인증)
 *   SPUM_WORLD_ASSIGNMENT_ACCESS — 위와 동일 용도의 대체 이름
 *
 * 주의: 프록시 URL 이 설정돼 있으면 런타임은 X-API-Key 를 아예 보내지 않는다
 *       (resolveRuntimeSamApiKey 가 sentinel 을 반환). 키는 서버에만 있으면 된다.
 */
(function bootstrapSpumLive(config) {
  const {
    proxyUrl = 'http://localhost:8787/api/sam/v1/generate',
    accessToken = '',
  } = config || {};

  globalThis.SPUM_WORLD_LLM_PROXY_URL = proxyUrl;
  if (accessToken) globalThis.SPUM_WORLD_ACCESS_TOKEN = accessToken;

  console.log('[spum-live] LLM 프록시:', proxyUrl);
  console.log('[spum-live] 액세스 토큰:', accessToken ? '설정됨' : '없음 (로컬 전용)');

  // 프록시가 살아 있는지 즉시 확인 — 조용히 실패하면 원인 찾기가 어렵다.
  const healthUrl = new URL(proxyUrl);
  healthUrl.pathname = '/healthz';
  healthUrl.search = '';
  fetch(healthUrl.toString())
    .then((r) => r.json())
    .then((h) => console.log('[spum-live] 프록시 확인 OK — 티어 프리셋:', h.preset, '누적 쌤:', h.screditTotal))
    .catch((e) => console.error('[spum-live] 프록시에 못 붙었습니다. `pnpm proxy` 가 떠 있는지, ALLOWED_ORIGINS 에 이 오리진이 있는지 확인하세요.', e));
})({
  // 여기를 고쳐서 쓴다.
  proxyUrl: 'http://localhost:8787/api/sam/v1/generate',
  accessToken: '',
});
