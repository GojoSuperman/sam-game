# SPUM 월드 + SAM API — 연동 구조

조사일 2026-08-18. 근거는 모두 `sam.soonsoon.ai` / `spum.soonsoon.ai` 에서 내려받은
실제 스펙과 소스이며, 추측한 부분은 "미확인" 으로 표시했다.

---

## 1. 두 서비스의 관계

| | SAM | SPUM Base |
|---|---|---|
| 주소 | `sam.soonsoon.ai` | `spum.soonsoon.ai` |
| 정체 | SoonSoon AI Management — 여러 AI 공급자를 하나의 API 로 묶은 게이트웨이 | 픽셀 월드 크리에이터 플랫폼 (캐릭터 제작 · 월드 제작 · 배포 · 라이센스) |
| 게임과의 관계 | 두뇌 (대화 · 퀘스트 · 행동 결정 · 이미지 생성) | 몸 (2D 엔진 · 맵 · 캐스트 · 배포 링크) |
| 요금 | SAM Builder ₩59,000/월 상당 | Creator Pro ₩99,000/월 — **SAM Builder 플랜 포함** |

SPUM Studio 는 이미 내부적으로 SAM 을 쓴다. 즉 우리가 SAM 을 붙이는 것은
새로운 통합이 아니라, **이미 있는 통합의 스위치를 켜고 그 위에 콘텐츠를 얹는 일**이다.

---

## 2. SAM API 표면

인증: `X-API-Key: sam-...` (또는 `Authorization: Bearer <id.soonsoon JWT>`)

공개 OpenAPI 스펙: **`https://sam.soonsoon.ai/openapi.json`** (v0.6.0, 엔드포인트 105개).
`/api-docs` 는 Vite SPA 라서 curl 로는 빈 페이지만 나온다 — 스펙을 볼 때는 위 JSON 을 쓴다.

### 게임에 쓰는 엔드포인트

| Method | Path | 용도 |
|---|---|---|
| POST | `/v1/generate` | **단일 진입점.** 텍스트 · 비전 · 문서 · 이미지 생성 · 툴 콜 · 구조화 JSON 전부 |
| POST | `/v1/image/generate` | 초상화 · 아이템 · 배경 |
| POST | `/v1/image/edit` | 마스크 기반 이미지 수정 |
| POST | `/v1/audio/transcriptions` | 음성 입력 |
| POST | `/v1/search`, `/v1/grounding` | 웹 인용 (게임엔 보통 불필요) |
| GET | `/v1/models` | **인증 없이 열려 있다.** 모델 52개 + 지연 + 단가 |
| GET | `/v1/account` | 키 유효성 · 쌤(SCredit) 잔액 |
| GET | `/v1/account/analytics` | 사용량 분석 (`group_by=model` 등) |

호환 표면: `/openai/v1/chat/completions` (OpenAI SDK), `/v1/messages` (Anthropic SDK),
`/v2/openai` · `/v2/anthropic` (Codex / Claude Code 용 provider-native passthrough).
게임 코드는 native `/v1/generate` 를 쓰는 게 맞다 — SPUM 런타임이 그걸 쓴다.

### `/v1/generate` 요청

```jsonc
{
  "model": "claude-haiku",              // 필수. alias
  "task": "chat",                        // chat | analyze | generate_image | code_generation | ui_design
  "messages": [{ "role": "user", "content": "..." }],
  "tools": [{ "name": "...", "description": "...", "parameters": { } }],
  "tool_choice": "auto",                 // auto | none | required | {type, function}
  "fallback": ["glm-4.7-flash"],         // 대체 모델
  "options": {
    "stream": true,                      // ★ 기본값이 true. JSON 으로 받으려면 false 명시
    "temperature": 0.7,
    "max_tokens": 4096,
    "thinking": false,
    "thinking_budget": 10000,
    "json_schema": { },                  // 구조화 출력 강제
    "image_size": "1536x1024"
  }
}
```

`options.stream` 의 기본값이 `true` 인 것이 가장 자주 걸리는 함정이다.

### 응답 (non-stream)

```jsonc
{
  "ok": true,
  "request_id": "req_abc123",
  "output": { "thinking": null, "content": "...", "tool_calls": null, "images": null },
  "usage": { "input_tokens": 12, "output_tokens": 15, "cost_usd": 0.000095,
             "scredits": 0.095, "scredits_remaining": 1999.905 },
  "meta": { "provider": "aws_bedrock", "model_id": "...", "duration_ms": 580 }
}
```

### SSE 이벤트

`thinking` · `content` · `tool_call` · `image` · `audio` · `usage` · `done` · `error`.
각 줄이 `data: {...}`. SPUM 런타임과 우리 클라이언트 모두 `\n` 단위로 파싱한다
(`\n\n` 만 기다리면 provider 에 따라 멈추는 경우가 있다).

### 에러 · 한도

재시도 의미 있음: `RATE_LIMITED`(429) · `PROVIDER_ERROR`(502) · `PROVIDER_UNAVAILABLE`(503)
→ `error.suggestion.retry_after_seconds` 만큼 대기.
재시도 무의미: `BUDGET_EXCEEDED` · `KEY_LIMIT_EXCEEDED` · `MODEL_NOT_FOUND` · `INVALID_KEY`.

Rate limit: **사용자 30 RPM / 키 20 RPM**. 게임은 NPC 수 × 대화 빈도로 호출이 폭발하므로
이 20 RPM 이 실질적인 설계 제약이다.

### SPUM 전용 네임스페이스

`/v1/spum/*` 22개 (`api-catalog`, `context`, `credits`, `licenses`, `modules`, `access`,
`profile`, `community/*`, `blog/*`, `notice/*`, `square-summary`).
전부 인증 필요 — **미확인**. 키를 넣고 `GET /v1/spum/api-catalog` 와 `/v1/spum/context` 를
찍어보면 SPUM 쪽 데이터를 SAM 으로 직접 읽는 경로가 열릴 가능성이 있다.

---

## 3. 모델 선정 (2026-08-18 `GET /v1/models` 실측)

게임에서는 지연이 곧 체감 품질이다. 말풍선이 1.2초 뒤에 뜨면 NPC 가 멍청해 보인다.

| alias | 지연 | 입력/출력 $/1M | 쓸 곳 |
|---|---|---|---|
| `gpt-5.4-nano` | **280ms** | 0.20 / 1.25 | 의도 분류, 라우팅 |
| `az-deepseek-v4-flash` | 350ms | 0.19 / 0.51 | 저가 대화 |
| `glm-4.7-flash` | 400ms | **0.06 / 0.40** | 배경 NPC 잡담, 생각 말풍선 |
| `gemini-3.5-flash` | 500ms | 1.5 / 9 | 균형 |
| `claude-haiku` | 600ms | 1.1 / 5.5 | 주요 캐릭터 연기, 툴 콜 |
| `claude-sonnet-4.6` | 1200ms | 3.3 / 16.5 | 퀘스트 설계, 행동 커맨드 JSON |
| `gpt-image-1-mini` | 3.5s | **$0.011/장** | 초상화 · 아이템 (빌드타임 사전 생성 권장) |
| `gpt-image` | 5s | $0.04/장 | 품질 우선 이미지 |

---

## 4. SPUM 월드의 AI 구조 — 여기가 핵심

월드 데이터(`world.ai`)에 AI 설정이 **이미 스키마로 들어 있다**
(`packages/spum-world/core/WorldAIState.js`).

```jsonc
world.ai = {
  enabled: true,
  conversationMode: "fsm",        // ★ "fsm" | "baked" | "llm"
  llmModel: "", controlModel: "", apiKey: "",
  worldGoal: "", currentTopic: "", theme: "", tone: "cozy-fantasy",
  missions: [],                    // 퀘스트 목록
  missionManagerEnabled: false,    // LLM 이 미션 생성·완료 판정
  missionManagerInterval: 7,
  characterDirectorEnabled: true,  // 주기적 LLM 호출로 캐릭터 성향 카드 갱신
  characterDirectorIntervalSec: 150,
  characterDrama: 1, emotionIntensity: 1, emotionalVolatility: 1,
  conflictTendency: 0, affinityInertia: 0, mbtiInfluence: 1,
  chattiness: "med",               // low | med | high
  autonomy: "balanced",
  directiveMode: "character_based",
  globalRules: [],
}
```

캐스트(월드에 배치된 캐릭터) 단위로는:

```jsonc
castEntry = {
  instanceId: "cast_01", characterId: "...",
  aiRole:   { title: "마을 이장", goal: "우물 사건을 감추려 한다" },
  aiPolicy: { listenToWorld: true, obedience: "character_based",
              autonomy: 0.7, memoryWrite: true, allowAutonomousTalk: true },
}
```

### `conversationMode` 세 가지

| 모드 | 동작 | LLM 호출 |
|---|---|---|
| `fsm` | 스크립트 상태 기계. 정해진 대사 풀에서 고름 | 없음 |
| `baked` | 미리 생성해 둔 대화 데이터(`runtime.bakedData`) 재생 | 없음 (생성 시점에만) |
| `llm` | **런타임에 SAM 호출해서 실시간 생성** | 매 대화마다 |

### NPC 행동 커맨드 (`packages/spum-world/runtime/RuntimeCommands.js`)

LLM 이 `{ "summary": "...", "commands": [...] }` 를 돌려주면 런타임이 실행한다.
**툴 콜이 아니라 JSON 커맨드 배열**이라는 점이 중요하다.

허용 `type`:
`say` · `think` · `remember` · `setRuntime` · `playState` · `playEmote` · `playEffect` ·
`stopEffect` · `moveToTile` · `moveToPoint` · `moveToActor` · `moveToConversationSpot` ·
`wander` · `idle` · `rest` · `sleep`

목록에 없는 `type` 은 `normalizeWorldAICommand()` 가 조용히 `null` 로 버린다.
emote 라벨은 `happy | greet | surprised | thinking | proud`.

---

## 5. ★ 배포된 월드는 라이브 LLM 을 못 쓴다

`studio/world-viewer/viewer.js` 의 `runtimeWorldForPlayback()` 이 공개 재생 시
월드 AI 설정을 **강제로 덮어쓴다**:

```js
ai: {
  ...ai,
  enabled: true,
  apiKey: '',                    // 키 제거
  conversationMode: 'baked',     // llm -> baked 강제
  directiveMode: 'ambient',
  missionManagerEnabled: false,  // 미션 매니저 정지
}
```

즉 `/studio/world-viewer/?publishId=...` 로 공유되는 링크에서는
**실시간 NPC 대화 · 동적 퀘스트 · 행동 결정이 전부 꺼진다.** 재생되는 것은
`runtime.bakedData` 에 미리 구워 넣은 대화뿐이다.

이건 버그가 아니라 의도된 설계다 — 공개 링크에서 아무나 남의 SAM 키로
토큰을 태우게 할 수 없기 때문이다. 같은 이유로 `studio/ai/AgentSettings.js` 는
localStorage 의 `apiKey` 를 읽는 즉시 삭제하고 `getStudioApiKey()` 가 빈 문자열을
반환한다 (과거 키 유출 흔적으로 `LEAKED_SAM_KEY_PREFIXES` 상수가 남아 있다).

### 그래서 레인이 두 개다

**레인 A — Studio 안에서 (오소링 · 개발 · 플레이테스트)**
`conversationMode: 'llm'` 을 켜면 라이브 대화 · 미션 매니저 · 캐릭터 디렉터가 전부 돈다.
Studio 는 same-origin `/api/sam` 프록시를 쓰고 로그인 세션으로 인증되므로
**따로 셋업할 게 없다.** 비용은 내 SAM 계정에 청구된다.

**레인 B — 배포**
두 가지 선택지:

1. **bakedData 를 크게 굽는다.** 공개 링크 그대로 쓴다. 실시간성은 없지만
   분기·토픽을 많이 넣으면 방문자에게는 충분히 살아 있어 보인다.
   → 이 리포의 `scripts/bake-world.mjs` 가 이걸 한다.
2. **월드를 직접 호스팅한다.** SPUM 런타임은
   `globalThis.SPUM_WORLD_LLM_PROXY_URL` 을 **매 호출마다** 읽으므로
   내 프록시를 가리키면 라이브 LLM 이 그대로 살아난다.
   → 이 리포의 `server/sam-proxy.mjs` + `web/spum-live-bootstrap.js` 가 이걸 한다.
   단 SPUM 엔진·런타임 파일을 내 도메인에서 서빙하는 것이 라이센스상 허용되는지는
   **미확인** — Creator Pro 의 "1개월 상용 이용" 범위를 SoonSoon 에 확인해야 한다.

---

## 6. ★ 티어 이름 변환 — 자체 프록시의 필수 조건

SPUM 월드 런타임(`packages/spum-world/runtime/WorldLLMModels.js`)은 모델을
`'light'` / `'medium'` / `'expert'` 세 티어 이름으로만 보낸다. 기본값은 `'medium'`.

**이 세 이름은 SAM 의 실제 alias 가 아니다.** `GET /v1/models` 52개에 없다.
`spum.soonsoon.ai` 의 `/api/sam` 프록시가 서버측에서 실제 모델로 바꿔주기 때문에
Studio 안에서는 그냥 동작한다.

내 프록시를 쓰면 **내가 변환해야 한다.** 안 하면 전부 `MODEL_NOT_FOUND`.
`src/tiers.mjs` 가 이 변환을 하고, `scripts/check-tiers.mjs` 가 매핑 대상이
실제로 존재하는 alias 인지 검사한다.

---

## 7. bakedData 스키마 (`schemaVersion: "0.4"`)

```jsonc
{
  "meta": { "schemaVersion": "0.4", "generatedAt": "...", "source": "...",
            "concept": "...", "generationMode": "...", "detailLevel": "...", "tone": "..." },
  "characters": { "하늘": { "id": "", "name": "하늘", "displayName": "하늘",
                            "title": "마을 이장", "speechStyle": "느릿한 존댓말" } },
  "thoughts":   { "하늘": { "idle":     [{ "text": "...", "emotion": "thinking" }],
                            "walk":     [{ "text": "...", "emotion": "neutral" }],
                            "approach": [{ "text": "...", "emotion": "greet" }] } },
  "threads": [ { "id": "...", "topic": "...",
                 "participants": ["하늘", "루"],
                 "turns": [{ "speaker": "하늘", "line": "...",
                             "emotion": "greet", "intent": "open" }] } ]
}
```

Studio 가 import 할 때 **조용히 버리는** 조건 (`WorldBakeBuilder.js` → `normalizeGeneratedBakedData`):

- `participants` 가 2명이 아니다 → thread 폐기 (정확히 2인 대화만 지원)
- `turns` 가 2개 미만 → thread 폐기
- `speaker` 가 월드에 배치된 캐릭터 이름이 아니다 → 그 turn 폐기
- `line` 이 `maxLineChars` 초과 → `...` 로 절단
- threads 가 `threadCount` 초과 → 초과분 잘림

`detailLevel` 별 상한 (`WORLD_BAKE_BUILDER_SAM_LIMITS`):

| detailLevel | threadCount | turnsPerThread | thoughtCount | maxLineChars |
|---|---|---|---|---|
| `summary` | 6 | 3 | 1 | 42 |
| `balanced` | 8 | 4 | 2 | 54 |
| `rich` | 10 | 4 | 2 | 56 |

`intent` 는 `open`(첫 turn) / `reply`(중간) / `finish`(마지막).
`emotion` 은 `neutral · happy · greet · surprised · thinking · proud · calm`.

---

## 8. SPUM 런타임이 읽는 전역 변수

`packages/spum-world/runtime/WorldLLMRuntimeTransport.js`:

| 전역 | 용도 |
|---|---|
| `SPUM_WORLD_LLM_PROXY_URL` | `/v1/generate` 를 보낼 URL. 미설정 시 `/api/sam/v1/generate` |
| `SPUM_WORLD_ACCESS_TOKEN` | `X-SPUM-WORLD-ACCESS` 헤더로 전송 |
| `SPUM_WORLD_ASSIGNMENT_ACCESS` | 위와 같은 용도의 대체 이름 |
| `__SAM_API_KEY__` | 프록시 URL 이 **없을 때만** `X-API-Key` 로 사용 |

프록시 URL 이 설정돼 있으면 런타임은 `X-API-Key` 를 **아예 보내지 않는다**
(`resolveRuntimeSamApiKey()` 가 sentinel 반환). 즉 프록시를 쓰는 순간
브라우저에 키를 둘 이유가 사라진다 — 이게 올바른 구성이다.

매 호출마다 읽으므로 이미 열려 있는 Studio 탭의 DevTools 콘솔에서
`SPUM_WORLD_LLM_PROXY_URL = '...'` 를 실행해도 즉시 반영된다.

---

## 9. 배포 URL 형태

`studio/pages/world/WorldPublishUrls.js`:

- 뷰어: `/studio/world-viewer/?publishId=<id>`
- 프레임(임베드): `/studio/world-frame/?publishId=<id>`
- 프레임 빌더: `/studio/world-frame-builder/?publishId=<id>`

`owner=1` 파라미터가 붙으면 소유자 모드.

---

## 10. 남은 미확인 항목

1. ~~`/v1/spum/api-catalog` · `/v1/spum/context` 의 실제 응답~~ → **11-5 에서 해소.**
   월드 데이터 경로는 없다.
2. Studio UI 에서 `conversationMode` 를 `llm` 로 바꾸는 위치 (World 페이지 AI 패널로 추정).
   단 현재 계정은 `canUseAI: false` 라 그 UI 가 열리는지 자체가 미확인.
3. SPUM 엔진 파일 자체 호스팅의 라이센스 허용 범위.
4. `bakedData` 를 Studio 에 넣는 UI 경로 — import 버튼이 있는지, 아니면
   bake 빌더로만 채워지는지. 후자라면 IndexedDB 직접 주입이 필요할 수 있다.
5. Studio 의 bake 빌더가 `canUseAI: false` 에 걸리는지.
---

## 11. 현재 계정 상태 — 실측 (2026-08-18 18:30~19:00)

키 4개(Master · SAC · Chat · SPUM)를 실제로 호출해서 확인한 결과.
`pnpm doctor` / `pnpm verify-keys` 로 언제든 재확인할 수 있다.

### 11-1. SAM 쪽 — 정상 (플랜 있음)

`GET /v1/account` (키 4개 모두 유효, prefix 매칭 4/4):

| 항목 | 값 |
|---|---|
| 플랜 | **Builder** (`builder`, source `jwt_org`) |
| 쌤 | 45,000 / 45,000 (사용 0) = **$45** (환산율 1000 쌤/USD) |
| 사용 가능 모델 | **51개** (전체 52개 중) |
| API 키 | 4 / 10 |
| 코딩 에이전트 | `codex: true`, `claude_code: false` |
| 스토리지 | 0 / 10 GiB |

`GET /v1/account/keys` — 키 4개 모두 `is_system_managed: true`, `can_delete: false`:

| name | kind | service_code | 월 한도(쌤) | 회전 |
|---|---|---|---|---|
| Master Key | `master` | — | 45,000 | X |
| SAC Key | `service` | `sac` | 45,000 | O |
| Chat Key | `service` | `chat` | 45,000 | O |
| SPUM Key | `service` | `spum` | 45,000 | O |

> **네 키 모두 월 한도가 계정 총액과 같다 — 예산이 격리되지 않는다.**
> 한 키가 폭주하면 45,000 쌤 전체를 소진한다. 게임은 호출이 폭발하기 쉬우므로
> `POST /v1/account/keys` 로 `monthly_ssam_limit` 을 낮춘 `custom` 키를 따로 발급하는 게 안전하다.
> 키 슬롯은 6개 남아 있다.

### 11-2. SPUM 쪽 — free 티어, AI 사용 불가

`GET /v1/spum/access`:

```jsonc
{ "role": "member", "membership": "free", "membershipLevel": "free", "credits": 0,
  "capabilities": {
    "tier": "free",
    "canUseAI": false,          // ★ Studio 안 AI 기능 불가
    "maxWorlds": 1,
    "maxCastPerWorld": 20,
    "canCreateWorld": true, "canEditWorld": true, "canDeleteWorld": false,
    "canManageCast": true, "canManageMap": true
  } }
```

SAM 은 `builder` 플랜인데 SPUM 은 `free` 다. 두 엔타이틀먼트가 분리돼 있고,
SPUM 랜딩의 문구가 정확히 이 경우를 말한다:

> "SAM 으로만 가입한 사용자는 부여받은 SAM 요금제만 사용할 수 있으며,
> SPUM Base 권한은 별도로 필요합니다."

**영향:**

| 레인 | 현재 가능? | 이유 |
|---|---|---|
| A — Studio 안 라이브 LLM | **불가** | `canUseAI: false` |
| B-1 — bake 후 공개 링크 | **일부 가능** | Studio 의 bake 빌더는 `canUseAI` 에 걸릴 것으로 보임(미확인). 다만 `pnpm bake` 는 SAM 을 직접 호출하므로 SPUM 권한과 무관하게 JSON 생성 가능. `maxWorlds: 1` 제약 |
| B-2 — 자체 호스팅 + 내 프록시 | **가능** | SAM 직접 호출이라 SPUM 권한과 무관 |

즉 이 리포의 셋업(프록시 + bake CLI)은 SPUM 의 `canUseAI` 제약을 우회한다.
Studio UI 안에서 AI 를 쓰려면 SPUM Base Creator Pro 권한이 필요하다.

### 11-3. ★ 현재 SAM 생성 호출 전면 불가 — 서버측 문제

```
POST /v1/generate  ->  503  약 30.7초 후
{"detail":"Account initialization is temporarily unavailable. Please retry."}
```

좁히기 결과 (`pnpm doctor`):

| 축을 바꿔봤을 때 | 결과 |
|---|---|
| 키 4개 각각 | 전부 동일 실패 → **키 문제 아님** |
| 모델 (`glm-4.7-flash` / `claude-haiku`) | 전부 동일 → 모델 문제 아님 |
| 표면 (native `/v1/generate` · `/openai/v1/chat/completions` · `/v1/messages`) | 전부 동일 → 표면 문제 아님 |
| 순차 호출로 바꿈 | 여전히 0/6 → 경합만의 문제도 아님 |
| `GET /v1/models` (공개) | 항상 200, ~1초 → 네트워크 정상 |
| `GET /v1/account`, `/v1/spum/credits` 등 | **200/503 을 오감** |

관찰된 특징:

- 실패는 항상 **약 30.7초 후** — 서버측 30초 타임아웃이 걸려 있다.
- `/v1/hello` 는 **181초** 뒤 504 까지 갔다.
- 503 이 **엔드포인트별로 무작위로 옮겨 다닌다.** 같은 엔드포인트가 어떤 실행에선
  200, 다음 실행에선 503 이다 (예: `/v1/spum/access` 200 → 503,
  `/v1/spum/api-catalog` 503 → 200 → 503).
- 계정은 오늘 07:04 UTC 생성, `ssam_used: 0` — **생성 호출이 한 번도 성공한 적 없다.**

같은 키로 일부 인증 엔드포인트가 200 을 주므로 키와 인증 레이어는 정상이다.
SAM 내부의 계정 프로비저닝 단계가 끝나지 않은 것으로, **클라이언트에서 고칠 수 없다.**
SoonSoon 측 처리가 필요하다.

### 11-4. 이 상황에 맞춘 클라이언트 보강

| 문제 | 대응 |
|---|---|
| 30초 hang | `src/sam.mjs` 에 요청 타임아웃 추가 (`SAM_TIMEOUT_MS`, 기본 45초). 게임 런타임에서는 훨씬 짧게 줘야 한다 |
| 긴 `detail` 이 code 자리에 들어가 로그가 깨짐 | `ACCOUNT_INITIALIZING` 코드로 정규화 |
| 재시도가 30초씩 낭비 | `ACCOUNT_INITIALIZING` 은 **최대 1회만** 재시도 |
| 503/504 가 재시도 대상에서 빠짐 | 재시도 판정을 `error.code` 뿐 아니라 **HTTP status(429·502·503·504)** 기준으로도 하도록 수정 |
| 원인 파악이 어려움 | `pnpm doctor` 로 키·모델·표면 축을 한 번에 좁힘 |

### 11-5. `/v1/spum/*` 는 월드 데이터 경로가 아니다

`GET /v1/spum/api-catalog` 가 자기 자신을 설명한다. 모듈 구성:

`membership`(access) · `settings`(profile) · `license-management`(licenses) ·
`market`(credits, ledger) · `square`(square-summary) · `notice` · `blog` · `community`

**월드·캐스트·맵 데이터를 읽거나 쓰는 엔드포인트는 없다.** 즉 SAM 을 통해
SPUM 월드 데이터를 조작하는 경로는 존재하지 않고, 월드는 Studio(브라우저) 쪽
`/api` 와 IndexedDB 가 관리한다. 10절의 미확인 항목 1번은 이로써 해소됐다.

