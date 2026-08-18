# SAM API 레퍼런스

SoonSoon AI Management — 여러 AI 공급자를 하나의 API 로 묶은 게이트웨이.

- Base URL: `https://sam.soonsoon.ai`
- **공개 OpenAPI 스펙: `https://sam.soonsoon.ai/openapi.json`** (v0.6.0, 엔드포인트 105개)
- 문서 페이지: `https://sam.soonsoon.ai/api-docs` — Vite SPA 라서 curl 로는 빈 페이지만 나온다. 브라우저로 열거나 위 JSON 을 쓴다.
- 키 발급: `https://sam.soonsoon.ai/api-keys`
- 조사·실측일: **2026-08-18**. 가격·지연·모델 목록은 자주 바뀌므로 `GET /v1/models` 로 재확인할 것.

---

## 인증

모든 엔드포인트가 아래 둘 중 하나를 요구한다.

```
X-API-Key: sam-xxxxxxxxxxxxxxxx
# 또는
Authorization: Bearer <id.soonsoon.ai JWT>
```

- API 키는 `sam-` 접두사. `/api-keys` 에서 발급.
- 웹 UI 는 HttpOnly 쿠키(`sam_access`)로 자동 관리.
- OpenAI 호환 경로(`/openai/v1/*`)에서는 키를 **Bearer 토큰으로** 넘긴다: `Authorization: Bearer sam-xxx`
- Anthropic 호환 경로(`/v1/messages`)는 `x-api-key` 헤더 또는 Bearer 둘 다 받는다.
- `openapi.json` 의 `components.securitySchemes` 는 비어 있다 — 자동 생성 클라이언트를 만들면 인증 헤더를 직접 붙여야 한다.

키 종류: `master`(자동 생성, 삭제 불가) / `service`(SoonSoon 서비스 전용 관리형) / `custom`(외부 앱 연동용, 직접 생성).

> 프로젝트별 비용을 분리하려면 월 쌤 한도를 지정한 `custom` 키를 프로젝트마다 따로 발급한다.

---

## 비용 단위 — 쌤(SCredit)

사용자에게 보이는 단위는 **쌤**이다. provider USD 비용에 환산율(기본 **1000 쌤/USD**)을 곱해 계산한다.
모든 usage 응답에 `cost_usd` 와 `scredits` 가 함께 온다.

---

## `POST /v1/generate` — 단일 진입점

텍스트 대화 · 이미지 분석 · 문서 분석 · 이미지 생성 · 코드 생성 · 도구 호출 · 구조화 JSON 을 모두 처리한다.

### 요청 본문

| 필드 | 타입 | 필수 | 기본 | 설명 |
|---|---|---|---|---|
| `model` | string | O | — | 모델 alias |
| `task` | string | | `chat` | `chat` \| `analyze` \| `generate_image` \| `code_generation` \| `ui_design` (이미지 전용 모델은 자동 감지) |
| `messages` | Message[] | O | — | 최소 1개 |
| `tools` | Tool[] | | — | 함수/도구 정의 |
| `tool_choice` | any | | — | `"auto"` \| `"none"` \| `"required"` \| `{type, function}` |
| `fallback` | string[] | | — | 대체 모델 alias 목록 |
| `options` | Options | | `{}` | 아래 |

### `options`

| 필드 | 범위 | 기본 | 설명 |
|---|---|---|---|
| `temperature` | 0.0–2.0 | 0.7 | |
| `max_tokens` | 1–200000 | 4096 | |
| `top_p` | 0.0–1.0 | 0.9 | |
| **`stream`** | boolean | **`true`** | ★ 기본이 true. JSON 으로 받으려면 `false` 를 명시해야 한다 |
| `thinking` | boolean | false | 추론 과정 출력 |
| `thinking_budget` | 0–100000 | 10000 | |
| `json_schema` | object | — | JSON Schema 로 구조화 출력 강제 |
| `image_size` | string | — | `WIDTHxHEIGHT` |
| `modalities` | string[] | — | `["text"]`, `["text","audio"]` |
| `audio` | object | — | `{voice, format}` |
| `stop_sequences` | string[] | — | |

> `options.stream` 의 기본값이 `true` 인 것이 가장 자주 걸리는 함정이다.

### Message content 타입

| `type` | `source` | 필수 필드 | 용도 |
|---|---|---|---|
| `text` | — | `text` | 텍스트 |
| `image` | `base64` \| `url` | `data`/`url` + `media_type` | 이미지 분석 |
| `document` | `base64` | `data` + `media_type` | PDF · CSV · TXT |
| `audio` | `base64` | `data` + `media_type` | 오디오 입력 |
| `video` | `base64` \| `url` | `data`/`url` + `media_type` | 비디오 (Nova Omni) |

```jsonc
// 텍스트
{ "role": "user", "content": "서울 날씨 알려줘" }

// 멀티모달
{ "role": "user", "content": [
  { "type": "text", "text": "이 이미지를 설명해줘" },
  { "type": "image", "source": "base64", "data": "...", "media_type": "image/png" }
]}
```

### 응답 (non-stream)

```jsonc
{
  "ok": true,
  "request_id": "req_abc123",
  "model": "claude-haiku",
  "task": "chat",
  "output": {
    "thinking": null,
    "content": "안녕하세요!",
    "tool_calls": null,
    "images": null
  },
  "usage": {
    "input_tokens": 12, "output_tokens": 15, "thinking_tokens": 0, "total_tokens": 27,
    "cost_usd": 0.000095, "scredits": 0.095, "scredits_remaining": 1999.905
  },
  "meta": { "provider": "aws_bedrock", "model_id": "us.anthropic.claude-haiku-4-5-...", "duration_ms": 580 }
}
```

`output.content` 는 보통 문자열이지만 provider 에 따라 배열/객체로 오는 경우가 있어 관용 처리가 필요하다.

### SSE 스트리밍

`stream: true` 면 `text/event-stream`. 각 줄이 `data: {...}`.

| event | data | 설명 |
|---|---|---|
| `thinking` | `{text}` | 추론 토큰 |
| `content` | `{text}` | 생성 텍스트 (점진적) |
| `tool_call` | `{id, name, arguments}` | 함수 호출 요청 |
| `image` | `{format, data, revised_prompt}` | 생성 이미지 (base64) |
| `audio` | `{id, data, format, transcript}` | 오디오 출력 |
| `usage` | `{input_tokens, output_tokens, cost_usd, scredits, ...}` | |
| `done` | `{request_id, model, duration_ms}` | 완료 |
| `error` | `{code, message, suggestion}` | |

> 파싱 시 `\n\n` 만 기다리면 provider 에 따라 멈춘다. **`\n` 단위로 줄을 잘라 `data: ` 접두사를 확인**하는 편이 안전하다 (SPUM 런타임도 이 방식).

### 구조화 출력 fallback

`qwen3-coder-next`, `fw-kimi-k2.7-code`, `az-deepseek-v4-pro` 등 native JSON schema 미지원 모델도
SAM 이 JSON-only prompt fallback 으로 보정한다. 다만 코드펜스가 섞여 오는 경우가 있어
파싱은 방어적으로 하는 게 좋다.

---

## 이미지

### `POST /v1/image/generate`

| 필드 | 타입 | 필수 | 기본 |
|---|---|---|---|
| `model` | string | O | — |
| `prompt` | string | O | — |
| `size` | string | | `1024x1024` |
| `quality` | string | | `low` |
| `n` | integer | | 1 |
| `stream` | boolean | | false |
| `partial_images` | integer | | 0 |
| `output_format` | string | | `png` |
| `output_compression` | int\|null | | null |
| `background` | string\|null | | null |
| `allow_experimental_sizes` | boolean | | false |

> `quality: "auto"` 는 Azure 에서 극도로 느려서 기본값이 `low` 로 바뀌었다 (변경 이력 확인).

### `POST /v1/image/edit`

위와 같고 추가로: `image`(O, base64 원본) · `image_media_type`(기본 `image/png`) · `mask`(base64) · `input_fidelity`(기본 `low`).

`/v1/generate` 로도 이미지 생성이 된다 (`task: "generate_image"`). img2img 는 messages 에 image content 를 넣는다.

---

## 웹 검색

- `POST /v1/search` — `query`(O), `max_results`(기본 10). 인용 포함.
- `POST /v1/grounding` — `prompt`(O), `max_tokens`(1024), `temperature`(0.2). 최신 웹 출처로 답변 + 인용.

## 음성

- `POST /v1/audio/transcriptions` — STT (`whisper`, `voxtral-mini`)
- `WS /v1/realtime/nova-sonic/ws` — 양방향 음성 대화
  - 클라이언트→서버: `start` · `audio.chunk` · `text.input` · `stop` · `ping`
  - 서버→클라이언트: `session.ready` · `completion.start` · `audio.chunk` · `usage` · `completion.end` · `error` · `pong`
  - 인증: same-origin `sam_access` 쿠키 / `Authorization: Bearer <JWT>` / query param(legacy)

---

## 모델

### `GET /v1/models`

**인증 없이 열려 있다.** 필터: `task`(`chat`\|`analyze`\|`generate_image`\|`embedding`) · `input`(`text`\|`image`\|`audio`\|`video`\|`document`) · `output`(`text`\|`thinking`\|`tool_call`\|`json`\|`image`) · `feature`(`streaming`\|`thinking`\|`function_calling`\|`structured_output`)

응답 항목 필드: `alias` · `model_id` · `display_name` · `provider` · `transport` · `family` ·
`capabilities` · `skills` · `skill_scores` · `specialties` · `limits` · `pricing` · `avg_latency_ms` ·
`api_pattern` · `catalog_visible` · `default_access` · `is_custom_composite` · `last_updated`

`pricing` 세부: `input_per_1m` · `output_per_1m` · `thinking_per_1m` · `image_input_per_1m` ·
`speech_input_per_1m` · `speech_output_per_1m` · `image_per_unit` · `audio_per_hour` ·
`cache_write_per_1m` · `cache_read_per_1m` · `context_tiers[]`

`GET /v1/models/{alias_or_id}` — 상세.

### 주요 모델 (2026-08-18 실측, 총 52개)

지연 낮은 순. 게임·실시간 UX 에서는 지연이 곧 체감 품질이다.

| alias | provider | 지연 | 입력/출력 $/1M | 특징 |
|---|---|---|---|---|
| `gpt-5.4-nano` | foundry | **280ms** | 0.20 / 1.25 | 최속. 라우팅·분류 |
| `az-deepseek-v4-flash` | foundry | 350ms | 0.19 / 0.51 | 저가 고속 |
| `glm-4.7-flash` | mantle | 400ms | **0.06 / 0.40** | 최저가 |
| `gemini-3.5-flash` | vertex | 500ms | 1.5 / 9 | |
| `gpt-5.4-mini` | foundry | 520ms | 1.5 / 9 | 중급 범용 |
| `claude-haiku` | mantle | 600ms | 1.1 / 5.5 | thinking 지원, 균형 |
| `glm-4.7` | mantle | 800ms | 0.4 / 1.5 | |
| `qwen3-coder-next` | mantle | 900ms | 0.5 / 1.2 | 코드 |
| `solar-pro4` | upstage | 1000ms | 0.3 / 1.2 | 한국어 |
| `openai.gpt-5.6-luna` | mantle | 1000ms | 1.1 / 6.6 | |
| `az-minimax-m3` | foundry | 1000ms | 0.33 / 1.32 | |
| `nemotron-nano-30b` | mantle | 1100ms | 0.06 / 0.24 | |
| `voxtral-mini` | mantle | 1100ms | 0.04 / 0.04 | 오디오 |
| `claude-sonnet-4.6` | bedrock | 1200ms | 3.3 / 16.5 | thinking + adaptive, 메인 코딩 |
| `az-deepseek-v4-pro` | foundry | 1200ms | 1.74 / 3.48 | |
| `gemma-3-27b` | mantle | 1300ms | 0.23 / 0.38 | |
| `fw-minimax-m3` | fireworks | 1300ms | 0.3 / 1.2 | |
| `fw-qwen3.7-plus` | fireworks | 1300ms | 0.4 / 1.6 | |
| `gpt-5.4` | foundry | 1800ms | 2.5 / 15 | 272K 표준 / 초과분 5.0·22.5 |
| `gemma-3-4b` | mantle | 1500ms | **0.04 / 0.08** | 초저가 경량 |
| `fw-kimi-k2.7-code` | fireworks | 1400ms | 0.95 / 4 | 코드 에이전트 특화 |
| `claude-opus-4.8` / `claude-opus-5` | mantle | 2500ms | 5.5 / 27.5 | 최고 품질 |
| `claude-sonnet-5` | mantle | 3692ms | 3.3 / 16.5 | thinking 16.5 |
| `claude-fable-5` | mantle | 4500ms | 10 / 50 | |
| `fw-kimi-k3` | fireworks | 2000ms | 3 / 15 | |
| `nova-sonic` | mantle | 1000ms | 0.33 / 2.75 | 음성 (speech 3.4/13.6) |

이미지 · 오디오 모델:

| alias | 지연 | 단가 |
|---|---|---|
| `gpt-image-1-mini` | 3.5s | **$0.011/장** |
| `gemini-3.1-flash-lite-image` | 4s | $0.0336/장 |
| `gpt-image` | 5s | $0.04/장 |
| `FLUX.2-pro` | 6.5s | $0.04/장 |
| `gemini-3.1-flash-image` | 3.5s | $0.0672/장 |
| `gemini-3-pro-image` | 7s | $0.1344/장 |
| `gpt-image-2` | 8s | 토큰 과금 (5 / 30, 이미지 입력 8) |
| `whisper` | 2.5s | $0.396/시간 |

provider 축약: `mantle` = `bedrock_mantle`, `foundry` = `microsoft_foundry`, `vertex` = `google_vertex`.

---

## 계정 · 키 · 사용량

| Method | Path | 설명 |
|---|---|---|
| GET | `/v1/account` | 상태, 예산, 사용 가능 모델. 주요 필드 `ssam_total` · `ssam_used` · `ssam_remaining` · `models_available` · `api_keys_count` |
| GET | `/v1/account/context` | 계정 전체 상태 통합 snapshot. `days`(14) · `recent_limit`(10) · `model_limit`(10) |
| GET | `/v1/account/budget-projection` | 예산 소진 예측 + 경고 레벨 |
| GET | `/v1/account/keys` | 키 목록 |
| POST | `/v1/account/keys` | 생성 (`name`, `monthly_ssam_limit`) |
| PATCH | `/v1/account/keys/{id}` | 수정 (`name`, `limit`, `rpm`) |
| DELETE | `/v1/account/keys/{id}` | 폐기 (되돌릴 수 없음) |
| POST | `/v1/account/keys/{id}/regenerate` | 시크릿 재생성 |
| POST | `/v1/account/keys/{id}/reveal` | 관리형 키 시크릿 표시 |
| POST | `/v1/account/keys/{id}/verify` | 키 바인딩 검증 |
| GET | `/v1/account/usage` | 이번 달 요약 |
| GET | `/v1/account/usage/models` | 모델별 |
| GET | `/v1/account/usage/daily` | 일별 (기본 14일) |
| GET | `/v1/account/usage/recent` | 최근 로그 (기본 20건) |
| GET | `/v1/account/plans`, `/v1/account/public-plans` | 요금제 |
| PATCH | `/v1/account/profile` | 커뮤니티 프로필 |

### `GET /v1/account/analytics`

| 파라미터 | 기본 | 값 |
|---|---|---|
| `scope` | `user` | `user` \| `api_key` |
| `window` | `1w` | `1h` \| `6h` \| `1d` \| `1w` \| `1mo` \| `1y` |
| `group_by` | `model` | `model` \| `service` \| `api_key` \| `error_code` \| `pricing_tier` |
| `bucket` | `auto` | `auto` \| `5m` \| `1h` \| `6h` \| `1d` \| `1w` \| `1mo` |
| `api_key_id` | — | `scope=api_key` 일 때 |
| `model_id`, `error_code` | — | 필터 |
| `from` / `to` | — | ISO 8601 |
| `limit` | 100 | breakdown 항목 수 |

---

## 호환 표면

### OpenAI 호환 — `/openai/v1`

```bash
curl https://sam.soonsoon.ai/openai/v1/chat/completions \
  -H "Authorization: Bearer sam-xxx" -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.4","messages":[{"role":"user","content":"Hello"}]}'
```

- Base URL 에 `/v1/generate` 를 넣으면 안 된다. SDK 가 `/chat/completions` 를 자동으로 붙이므로 `404` 가 난다.
- `GET /openai/v1/models` 는 기본적으로 coding-agent용 curated 목록만 반환. `?surface=all` 로 전체, `?scope=mine` 으로 현재 키가 쓸 수 있는 것.
- 확장 필드: `x_specialties` · `x_best_for` · `x_coding_agent_ready`
- 그 외: `/openai/v1/responses` · `/openai/v1/audio/transcriptions`, 그리고 `/openai-next/v1/*` 계열

### Anthropic 호환 — `POST /v1/messages`

```bash
curl https://sam.soonsoon.ai/v1/messages \
  -H "x-api-key: sam-xxx" -H "content-type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-haiku","max_tokens":1024,"messages":[{"role":"user","content":"Hello"}]}'
```

지원: `model` · `messages` · `max_tokens` · `stream` · `temperature` · `system`.
Claude 외 모델도 Anthropic 형식으로 호출 가능. Claude Code 안정성을 위해 thinking block 은 기본 숨김.
`POST /v1/messages/count_tokens` 도 있다.

### V2 — provider-native passthrough (코딩 에이전트)

번역 없이 provider wire 를 그대로 통과시키고 인증·예산·사용량만 side-band 로 얹는다.

| 클라이언트 | Base URL | 호출 경로 |
|---|---|---|
| Codex / OpenAI | `https://sam.soonsoon.ai/v2/openai` | `/responses`, `/chat/completions` |
| Claude Code / Anthropic | `https://sam.soonsoon.ai/v2/anthropic` | `/v1/messages`, `/v1/messages/count_tokens` |
| 모델 검색 | `GET /v2/code-agents/models` | |

`/v2/anthropic/v1/messages` 의 `v1` 은 Anthropic wire 접미사이지 SAM API V1 이 아니다.

검증 모델 (첫 release 시점 정확히 3개): `gpt-5.6-terra`(openai_chat) · `openai.gpt-5.6-terra`(mantle_responses, Codex) · `claude-sonnet-5`(mantle_anthropic, Claude Code).
미지원 모델은 폴백 없이 `MODEL_NOT_NATIVE_ON_SURFACE` 를 반환한다.

별도 grant 필요: `agent:codex` · `agent:claude_code` · `agent:coding_agents`.

그 외 V2 provider-native: `/v2/aws-bedrock/model/{alias}/{operation}` · `/v2/azure/openai/deployments/{alias}/*` ·
`/v2/google/v1/models/{alias}:generateContent` · `/v2/claude/v1/messages` · `/v2/codex/responses` · `/v2/generate`

### 그 외

- `POST /mcp` — MCP 서버 엔드포인트
- `/v1/session/*` — 웹 세션 (login/logout/refresh/me)
- `/v1/spaces` — 계정 Space CRUD
- `/v1/benchmarks`, `/v1/benchmarks/summary` — 크라우드소싱 모델 벤치마크
- `/v1/community/*` — 게시판
- `/v1/spum/*` (22개) — SPUM 연동: `api-catalog` · `context` · `credits` · `licenses` · `modules` · `access` · `profile` · `blog/*` · `notice/*` · `community/*` · `square-summary`
- `/v1/models/code-agent-catalog/*`, `/v1/models/code-agent-profiles/*` — 코딩 에이전트 카탈로그 관리(관리자)
- `/v1/hello` — 헬스체크 겸 인사

---

## 에러 · 한도

```jsonc
{
  "ok": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "suggestion": { "retry_after_seconds": 45, "limit": 30, "window": "1 minute" }
  }
}
```

| HTTP | code | 재시도 | 설명 |
|---|---|---|---|
| 401 | `AUTH_REQUIRED` | X | 인증 토큰 없음 |
| 401 | `INVALID_KEY` | X | 유효하지 않은 키 |
| 401 | `TOKEN_EXPIRED` | X | JWT 만료 |
| 403 | `ACCOUNT_SUSPENDED` | X | 계정 정지 |
| 404 | `MODEL_NOT_FOUND` | X | 모델 없음 |
| 422 | `INVALID_REQUEST` | X | 요청 형식 오류 |
| 422 | `CAPABILITY_MISMATCH` | X | 기능 미지원 (`suggestion.use_model` 참조) |
| 422 | `THINKING_NOT_SUPPORTED` | X | thinking 미지원 모델 |
| 413 | `CONTENT_TOO_LARGE` | X | 입력 크기 초과 |
| 429 | `RATE_LIMITED` | **O** | `suggestion.retry_after_seconds` 대기 |
| 429 | `BUDGET_EXCEEDED` | X | 월 예산 초과 |
| 429 | `KEY_LIMIT_EXCEEDED` | X | 키 월 한도 초과 |
| 502 | `PROVIDER_ERROR` | **O** | `fallback` 설정 시 자동 대체 |
| 503 | `PROVIDER_UNAVAILABLE` | **O** | 일시 불가 |
| — | `HOSTED_TOOL_NOT_BILLABLE` | X | 과금 불가한 hosted tool 거부 (Codex `web_search` 등) |
| — | `MODEL_NOT_NATIVE_ON_SURFACE` | X | V2 표면 미검증 모델 |

### Rate Limit

| 범위 | 기본 RPM |
|---|---|
| User | 30 |
| API Key | 20 |
| Admin | 120 |

응답 헤더: `X-RateLimit-Limit` · `X-RateLimit-Remaining` · `X-RateLimit-Key-Limit` · `X-RateLimit-Key-Remaining`

---

## IDE 연동 요약

| 도구 | 설정 |
|---|---|
| Cline (권장) | OpenAI Compatible / `https://sam.soonsoon.ai/openai/v1` / Model ID 에 아무 alias |
| Continue | `~/.continue/config.yaml` — `provider: openai`, `apiBase: .../openai/v1` |
| Kilo Code | OpenAI Compatible / `.../openai/v1` |
| Cursor | Override OpenAI Base URL. **빌트인 GPT 모델만 안정 동작** — 커스텀 모델명은 Cursor 버그로 응답 미표시 (2026-06 기준 미해결) |
| OpenCode | `@ai-sdk/openai-compatible`, `baseURL` 에 root 만 (`/chat/completions` 자동 부착) |
| Codex | `~/.codex/config.toml` — `base_url = ".../v2/openai"`, `wire_api = "responses"`, `model = "openai.gpt-5.6-terra"`, **`web_search = "disabled"` 필수** |
| Claude Code | `ANTHROPIC_BASE_URL=".../v2/anthropic"`, **`ANTHROPIC_AUTH_TOKEN`**(≠ `ANTHROPIC_API_KEY`), `ANTHROPIC_MODEL="claude-sonnet-5"` |

---

## 자주 걸리는 함정

1. **`options.stream` 기본값이 `true`.** 논스트리밍을 원하면 반드시 `false` 명시.
2. **OpenAI 호환 Base URL 에 `/v1/generate` 를 넣지 않는다.** → `/v1/generate/chat/completions` 404.
3. **SSE 파싱은 `\n` 단위로.** `\n\n` 만 기다리면 provider 에 따라 멈춘다.
4. **Claude Code 는 `ANTHROPIC_AUTH_TOKEN`.** `ANTHROPIC_API_KEY` 로는 custom gateway 인증이 안 된다.
5. **키 20 RPM.** 병렬 호출이 많은 앱은 여기 먼저 닿는다.
6. **`light`/`medium`/`expert` 는 SAM alias 가 아니다.** SPUM 월드 런타임 전용 티어 이름이며 SPUM 의 `/api/sam` 프록시가 변환한다. 자체 프록시를 쓰면 직접 변환해야 한다.
7. **키를 브라우저에 두지 않는다.** SAM 도 SPUM 도 같은 결론에 도달했다 — 반드시 서버 프록시 경유.
8. **모델 단가·지연은 자주 바뀐다.** 문서 수치를 신뢰하지 말고 `GET /v1/models` 로 확인.
