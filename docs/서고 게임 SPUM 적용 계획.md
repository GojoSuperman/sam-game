# 서고 심문 게임 → SPUM + SAM 적용 계획

대상: `https://tigermorning.github.io/seogo-night-play/` (단일 HTML 143KB, script 2,649줄)
조사일 2026-08-18. 근거는 실제로 내려받아 읽은 코드와 실호출 결과이며, 확인 못 한 것은 **미확인**으로 적었다.

---

## 1. 게임 코드에서 확인한 것

구조가 이미 좋다. 특히 **LLM 없이도 완전히 돌아간다** — 이게 이후 모든 판단의 전제다.

| 항목 | 실제 |
|---|---|
| 규모 | ROOMS 6 · HOURS 6 (21~02시) · NPCS 5 · BEATS 18 (`TICKS 6 × PER_TICK 3`) |
| 렌더링 | DOM only. `<canvas>` 0개, `requestAnimationFrame` 0회 |
| 한국어 처리 | 직접 구현 — `JOSA` · `EOMI` · `STEMMAP` · `morph()` · `parse()` · `address()` · 종성 판별(`jong`) |
| 진실의 원천 | `newCase()` 가 정한 코드 데이터. LLM 권한 없음 |
| LLM 계층 | `LLM.chat(sys, user, schema)` 하나로 공급자 차이를 흡수. provider = `mock` \| `openai` \| `anthropic` |
| **기본값** | **`provider: 'mock'`** — 키가 없으면 `interpret()` · `fallbackLine()` 로 결정론 동작 |
| LLM 호출 지점 | 3곳 — `interpret()`(의도 파싱, `INTERP_SCHEMA`) · 사회적 대사 초안 · `converse()`(`buildPrompt`) |
| 사실 검증 | `verifyReply()` 가 허락 안 된 시각·장소·사람을 걸러 문장 폐기 |
| 인내/쿨다운 | `COST_ASK 8` · `COST_PUSH 18` · `COOL 30` |

SAM 관련 코드도 이미 있다:

```js
const SAM_EP='https://sam.soonsoon.ai/openai/v1';    // OpenAI 호환
const SAM_A ='https://sam.soonsoon.ai/v2/anthropic'; // Anthropic V2
const CFGKEY='seogo.llm';                            // localStorage 에 키 저장
```

---

## 2. ★ 결론 — 이 게임은 "배포된 SPUM 월드"가 될 수 없다

측정 결과이고, 우회할 방법이 없다.

| 측정 | 결과 |
|---|---|
| `studio/world-viewer/viewer.js` 의 입력 요소 | `<input>` · `<textarea>` **0개**, `keydown`/`input` 리스너 **0개** |
| 존재하는 버튼 | share · toggle-activity · fit · pause · fullscreen · filter-events — 전부 관람 조작 |
| `addEventListener('message')` | **`spum-frame-set-viewport` 한 종류뿐** (카메라 줌/팬), 게다가 `event.origin !== window.location.origin` 이면 즉시 반환 |
| 공개 재생 시 AI 설정 | `runtimeWorldForPlayback()` 이 `conversationMode: 'baked'`, `apiKey: ''`, `missionManagerEnabled: false` 로 **강제** |

즉 공개된 SPUM 월드는 **관람용 디오라마**다. 플레이어가 타이핑할 창구가 없고,
외부 페이지가 postMessage 로 게임을 조작할 수도 없다(카메라만, 그것도 same-origin).

이 게임의 핵심 루프는 "플레이어가 질문을 타이핑 → NPC가 답한다" 다.
SPUM 배포 표면에는 그 입력을 받을 자리가 없다.

여기에 계정 제약이 더 겹친다 (`GET /v1/spum/access` 실측):
`membership: "free"` · **`canUseAI: false`** · `maxWorlds: 1` · `maxCastPerWorld: 20`.

---

## 3. 선택지 세 개

### A. SPUM을 **에셋 파이프라인으로만** 쓴다 — 권장

SPUM Studio 에서 다섯 용의자를 픽셀 캐릭터로 만들고, 스프라이트를 내보내
지금의 seogo 페이지 안에서 렌더한다. SPUM 엔진·런타임은 쓰지 않는다.

| | |
|---|---|
| 장점 | free 티어로 가능(`canManageCast: true`, `canCreateWorld: true`), 라이센스 문제 없음, 게임 구조를 하나도 안 바꿔도 됨 |
| 단점 | 픽셀 월드가 "움직이지" 않는다. 초상화·표정 정도 |
| 작업량 | 작다. 캐릭터 5인 제작 + 스프라이트 삽입 |
| 미확인 | free 티어에서 스프라이트 PNG export 가 되는지 |

### B. SPUM 엔진을 **자체 호스팅**한다 (레인 B-2)

내 페이지에서 `spum-engine` + `spum-world` 런타임을 서빙하면 입력 UI를 내가 붙일 수 있고,
`RuntimeCommands`(`say` · `think` · `playEmote` · `moveToActor` · `moveToConversationSpot`)로
seogo 엔진이 픽셀 월드를 직접 조종할 수 있다. 낮 피드의 `하웰 · 도른 — 부엌` 이
실제로 두 스프라이트가 부엌에서 만나는 장면이 된다.

| | |
|---|---|
| 장점 | 원하는 그림이 다 나온다. 심문 + 살아 움직이는 월드 |
| 단점 | 통합 작업이 크다. 좌표계·타일맵·에셋 로더를 이해해야 한다 |
| **막힌 것** | **SPUM 엔진 파일을 내 도메인에서 서빙하는 것이 Creator Pro 라이센스 범위인지 미확인.** 공개 배포 전 SoonSoon 확인 필요 |

### C. SPUM을 안 쓴다 — 지금 게임 + SAM 프록시만

가장 빠르고 위험이 없다. SPUM 을 쓰겠다는 목표를 포기하는 것이라 여기 적어만 둔다.

> **권장 순서: A 로 시작해서 게임을 완성하고, B는 라이센스 답을 받은 뒤에 검토한다.**
> B에 먼저 들어가면 라이센스 답 하나에 작업 전체가 막힌다.

---

## 4. 지금 코드에서 고쳐야 할 것

우선순위 순. 1번은 SPUM/SAM 결합 여부와 무관하게 반드시 고쳐야 한다.

### 4-1. API 키가 브라우저 localStorage 에 있다 — 시급

```js
const CFGKEY='seogo.llm';
function cfgSave(c){ localStorage.setItem(CFGKEY, JSON.stringify(c)) }   // key 포함
```

GitHub Pages 로 공개된 페이지에서 방문자가 자기 키를 넣는 구조라면 그 방문자 책임이지만,
**내 키를 넣어 배포하면 즉시 유출**이다. SPUM 도 같은 실수를 이미 거쳐서 고쳤다 —
`studio/ai/AgentSettings.js` 는 localStorage 의 `apiKey` 를 읽는 즉시 삭제하고
`getStudioApiKey()` 가 빈 문자열을 반환하며, 유출 흔적으로 `LEAKED_SAM_KEY_PREFIXES`
상수가 남아 있다.

**대응:** 이 리포의 `server/sam-proxy.mjs` 를 경유한다. 게임 쪽 변경은 작다 —
`LLM.use('openai', { endpoint: 'http://localhost:8787/api/sam/openai/v1', key: '' })`
로 키 없이 부르고, 키는 서버에만 둔다. 프록시가 `X-API-Key` 를 붙인다.

### 4-2. `SAM_A = '/v2/anthropic'` 는 이 계정에서 못 쓸 가능성이 높다

SAM 문서상 V2 provider-native 표면은 별도 grant 가 필요하다:
`agent:codex` · `agent:claude_code` · `agent:coding_agents`.
실측한 계정 상태는 `coding_agent_access: { codex: true, claude_code: false }` 다.

또한 V2 는 "첫 release 검증 모델 3개"만 열려 있고 그 목록의 Anthropic 항목은
`claude-sonnet-5` 다. 게임 기본값인 `claude-haiku` 는 목록에 없어
`MODEL_NOT_NATIVE_ON_SURFACE` 를 받을 수 있다.

**대응:** Anthropic 규약을 쓰고 싶으면 V2 가 아니라 **V1 호환 `POST /v1/messages`** 를 쓴다.
grant 가 필요 없고 SAM alias 를 그대로 받는다.

```js
const SAM_A = 'https://sam.soonsoon.ai';   // /v1/messages 를 붙인다
```

> 지금은 계정 초기화 503 때문에 **실호출로 확인하지 못했다 (미확인).**
> 문서와 계정 권한에 근거한 추론이다.

### 4-3. 요청 타임아웃이 없다

`LLM.chat()` 의 `fetch` 에 `signal` 이 없다. SAM 이 계정 초기화에 실패하면
**약 30.7초 뒤**에 503 을 준다(실측). 그 30초 동안 게임이 멈춘다.
`/v1/hello` 는 181초까지 갔다.

**대응:** `AbortSignal.timeout()` 을 걸고, 만료 시 `fallbackLine()` 으로 조용히 내려간다.
게임은 이미 mock 폴백이 있으니 **연결이 죽어도 플레이가 끊기지 않게 만들 수 있다.**
대사 한 줄에 8~10초가 상한으로 적당하다.

### 4-4. Rate limit 대비가 없다

SAM 은 **키 20 RPM / 사용자 30 RPM**. 게임의 LLM 호출은 턴당 2~3회
(`interpret` + `converse` + 간헐적 사회 대사)이므로 **한 판 18턴에 36~54회**다.
빠르게 치는 플레이어는 분당 6~9회로 한도 안이지만, 틱 경계에서 `mingle()` 이
사회적 대사를 몰아 만들면 순간적으로 20 RPM 을 넘을 수 있다.

**대응:** 429 의 `error.suggestion.retry_after_seconds` 를 존중하는 재시도 +
동시 호출 상한(1~2개) 큐. 이 리포의 `src/sam.mjs` 가 이미 그렇게 한다.

### 4-5. `response_format` 과 스키마 처리

OpenAI 경로에서 `body.response_format = {type:'json_object'}` 를 쓰고 400 이면
`noSchema` 로 내려가는 구조는 안전하다. 다만 SAM native `/v1/generate` 는
**`options.json_schema`** 로 스키마 자체를 받고, native JSON schema 미지원 모델도
SAM 이 JSON-only prompt fallback 으로 보정한다. `interpret()` 의 `INTERP_SCHEMA` 를
그대로 넘길 수 있으니 native 경로가 더 유리하다.

또한 **`options.stream` 기본값이 `true`** 다 — native 경로로 바꾸면
`options: { stream: false }` 를 반드시 명시해야 한다.

### 4-6. 티어 이름 문제는 해당 없음

게임은 `claude-haiku` 같은 **실제 SAM alias** 를 쓴다. SPUM 월드 런타임이 쓰는
`light`/`medium`/`expert` 는 SAM alias 가 아니어서 변환이 필요하지만, 이 게임에는
그 문제가 없다. (선택지 B로 가면 그때 필요해진다 — `src/tiers.mjs` 가 처리한다.)

---

## 5. 문서에 적힌 MISSING 네 개를 어떻게 채우나

### 5-1. "판을 넘는 기억이 없다" — 가장 큰 구멍

SAM 이 필요 없다. 저장소 문제다. 다만 **설계 함정이 하나 있다.**

이월할 것과 이월하면 안 되는 것을 반드시 갈라야 한다:

| 이월 O — 관계 상태 | 이월 X — 사건 사실 |
|---|---|
| 신뢰 기준선 (지난 판에서 다독였는가) | 누가 첩자였는가 |
| 앙심 — 없는 증언을 들이댄 횟수 | 절도 시각 |
| 무례 지적 이력 | 공범이 누구였는가 |
| 고백을 들은 적이 있는가 | 방·시각 배치 |

사건 사실을 이월하면 **다음 판 정답이 새는** 즉시 게임이 망한다.
첩자는 판마다 새로 뽑히므로, "지난 판에 도른이 첩자였다"는 기억은
플레이어에게 잘못된 확신을 주거나 정답을 흘린다.

권장 형태 — NPC 정체성별 인상 레코드 하나:

```jsonc
// localStorage: seogo.bond.v1
{ "dorn": { "cases": 3, "trustBase": -2, "grudges": 1,
            "confessedTo": true, "rudeMarks": 0, "lastSeen": "2026-08-18" } }
```

판 시작 시 `G.trust[id]` 초기값에 `trustBase` 를 더하고, 첫 대면 대사에
"또 오셨소" 류 한 줄을 붙인다. 이것만으로 "쌓인다"는 감각이 생긴다.

### 5-2. "사실은 막지만 말투는 못 막는다"

`verifyReply()` 가 보는 것은 시각·장소·사람뿐이다. 여기가 SAM 이 실제로 기여할 자리다.
다만 **턴마다 검사 호출을 추가하면 비용과 지연이 두 배**가 되니 순서를 지킨다.

1. **먼저 생성 단계에서 좁힌다 (무료).** 각 인물의 말투 서명을
   `buildPrompt()` 시스템문에 명시한다 — 허용 종결어미 목록, 호칭,
   금지 표현, 한 번에 말하는 문장 수. 게임에 이미 `EOMI` · `HONOR` · `HAIL` ·
   `NAMEOF` 가 있으니 데이터는 이미 있다.
2. **결정론 검사를 먼저 돌린다 (무료).** 종결어미 화이트리스트와 호칭이
   그 인물 것인지 정규식으로 본다. 어긋나면 재생성. 이게 대부분을 잡는다.
3. **그래도 새는 드리프트만 LLM 심판에 맡긴다 (유료, 표본).**
   매 턴이 아니라 5턴에 1회 같은 표본으로, `light` 티어(`glm-4.7-flash`,
   400ms, $0.06/$0.40 per 1M)에 `json_schema` 로 `{ok, reason}` 만 받는다.
   비용이 거의 안 붙는다.

### 5-3. "몰아붙여 입을 닫은 사람이 시간이 지나면 다시 말한다"

`COOL 30` 으로 인내가 회복되는 구조. SAM 무관, 설계 결정이다.

권장: 회복에 **바닥**을 둔다. 몰아붙인 횟수만큼 그 인물의 인내 상한을
영구히 깎는다(`patienceCap[id] -= 5` 같은). 완전히 닫히지는 않지만
"예전만큼 열리지 않는다"가 되어 되돌리기 없음 원칙과 맞는다.
그리고 로스터에 그 인물이 나를 어떻게 기억하는지 한 줄로 보여준다.

### 5-4. "신뢰가 말의 양으로만 느껴진다"

숫자로 보여주지 않겠다는 판단은 유지하는 게 맞다 — 숫자가 보이면
플레이어가 수치를 최적화하기 시작하고 심문이 사라진다.

대신 **이산 상태**로 보여준다: `닫힘 · 경계 · 보통 · 열림` 네 단계.
변화의 방향만 알려주고 크기는 감추면, 가시성은 얻고 애매함은 지킨다.

**여기가 SPUM 이 가장 잘 쓰이는 자리다.** 네 단계를 픽셀 초상의 표정으로 바꾼다.
SPUM 의 emote 라벨이 정확히 이런 용도다 — `thinking` · `surprised` · `proud` ·
`happy` · `greet`. 선택지 A로도 충분히 된다(표정별 스프라이트 5장씩).

---

## 6. SPUM 이 실제로 기여할 수 있는 것

과장 없이, 지금 게임에 없어서 SPUM 이 채울 수 있는 것만.

| 게임의 요소 | SPUM 으로 |
|---|---|
| 다섯 용의자 (텍스트 이름) | 픽셀 초상 + 표정 4~5단계 → 5-4 의 신뢰 가시화 |
| 낮 피드 `하웰 · 도른 — 부엌` | 방 안에 두 스프라이트가 함께 있는 그림 (A는 정지 컷, B는 실제 이동) |
| 방 6개 (텍스트 목록) | 타일맵 미니맵. 증언판의 방을 클릭하면 그 방 그림 |
| 끝 화면 "진짜 동선표" | 시각별로 스프라이트가 움직이는 리플레이 (B에서만) |
| 증언판 6×5 격자 | 그대로 둔다. SPUM 이 개선할 부분이 아니다 |

반대로 **SPUM 이 못 하는 것**: 자유 타이핑 심문, 긴 대사(말풍선 상한 42~56자),
2인 초과 대화 스레드, 플레이어 입력 수집.

---

## 7. 비용·한도 예산

`claude-haiku` ($1.1 in / $5.5 out per 1M) 기준 **추정**이다. 실측이 아니다 —
현재 SAM 생성 호출이 503 으로 막혀 있어 실제 토큰 수를 재지 못했다.

| 항목 | 가정 | 판당 |
|---|---|---|
| `interpret()` | 800 in / 100 out × 18턴 | ~$0.026 |
| `converse()` | 2,000 in / 200 out × 18턴 | ~$0.059 |
| 사회적 대사 | 10회 × 1,000 in / 120 out | ~$0.018 |
| **합** | | **~$0.10 = 약 100 쌤** |

보유 45,000 쌤 → **약 450판**. `light` 티어로 내리면 10배 이상 늘지만,
게임 주석에 "7B 는 규칙을 못 지켰다"고 적혀 있으니 품질은 실측해야 한다.

주의: 네 키(Master · SAC · Chat · SPUM) **모두 월 한도가 계정 총액(45,000)과 같아
예산이 격리되지 않는다.** 게임이 폭주하면 45,000 을 다 쓴다.
`POST /v1/account/keys` 로 `monthly_ssam_limit` 을 낮춘 `custom` 키를
이 게임 전용으로 발급하는 것을 권한다(키 슬롯 6개 남음).

---

## 8. 진행 순서 제안

SAM 생성이 막혀 있어도 1~3은 지금 할 수 있다.

1. **키를 프록시 뒤로 옮긴다** (4-1). SAM 상태와 무관. 가장 시급.
2. **타임아웃 + 429 재시도**를 넣는다 (4-3, 4-4). mock 폴백이 이미 있으니
   연결이 죽어도 게임이 안 끊기게 만든다.
3. **판을 넘는 기억**을 설계·구현한다 (5-1). SAM 무관, 효과가 가장 크다.
   이월 O/X 경계를 먼저 문서로 확정한다.
4. **말투 서명을 프롬프트와 결정론 검사에 넣는다** (5-2의 1·2단계). SAM 무관.
5. SPUM Studio 에서 **다섯 캐릭터 제작 + 표정 스프라이트 export** (선택지 A).
   free 티어에서 export 가 되는지 먼저 확인.
6. SAM 이 열리면 `SAM_A` 를 `/v1/messages` 로 바꾸고 (4-2) 실호출 검증.
   `light` vs `medium` 품질을 같은 프롬프트로 비교한다.
7. SoonSoon 에 **엔진 자체 호스팅 라이센스**를 문의한다. 답이 오면 선택지 B 검토.

---

## 9. 미확인 항목

1. `/v2/anthropic` 이 `claude_code: false` 로 실제로 거부되는지 — 계정 503 때문에 미검증.
2. SPUM free 티어에서 캐릭터 스프라이트 PNG export 가 가능한지.
3. SPUM 엔진 자체 호스팅의 라이센스 허용 범위.
4. `light` 티어 모델이 이 게임의 프롬프트 규칙을 지킬 수 있는지 (품질 실측 필요).
5. `mingle()` 이 틱 경계에서 만드는 사회적 대사의 실제 동시 호출 수 — 20 RPM 초과 여부.
