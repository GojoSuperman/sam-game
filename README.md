# sam-game

SPUM 월드 위에 SAM API 로 게임을 만들기 위한 셋업.

- 조사 결과와 구조 전체: **[docs/SPUM SAM 연동 구조.md](docs/SPUM%20SAM%20연동%20구조.md)**
- 맵 스키마와 생성기: **[docs/SPUM 맵 스키마와 생성.md](docs/SPUM%20맵%20스키마와%20생성.md)**
- 무엇을 Studio 에서 / 무엇을 코드에서: **[docs/Studio와 Claude Code 역할 분담.md](docs/Studio%EC%99%80%20Claude%20Code%20%EC%97%AD%ED%95%A0%20%EB%B6%84%EB%8B%B4.md)**
- 이미지로 맵 만들기 (스킬 계획): **[docs/이미지로 맵 만들기 — 스킬 계획서.md](docs/%EC%9D%B4%EB%AF%B8%EC%A7%80%EB%A1%9C%20%EB%A7%B5%20%EB%A7%8C%EB%93%A4%EA%B8%B0%20%E2%80%94%20%EC%8A%A4%ED%82%AC%20%EA%B3%84%ED%9A%8D%EC%84%9C.md)**
- SAM API 스펙 전체: **[docs/SAM API 레퍼런스.md](docs/SAM%20API%20레퍼런스.md)**
- 요구 환경: Node 22+ (현재 v24.16.0 확인), 의존성 없음 — 전부 표준 라이브러리

## 현재 상태 (2026-08-18 19:00 실측)

두 가지가 막혀 있다. 자세한 근거는 연동 구조 문서 11절.

1. **SAM 생성 호출 전면 불가** — `POST /v1/generate` 가 약 30.7초 뒤 503
   `Account initialization is temporarily unavailable`. 키 4개·모델·표면(native/OpenAI/Anthropic)을
   모두 바꿔봐도 동일하고, `GET /v1/models` 는 항상 200 이다. **SoonSoon 서버측 문제**로
   클라이언트에서 고칠 수 없다. `pnpm doctor` 로 상태를 다시 확인한다.
2. **SPUM 은 free 티어, `canUseAI: false`** — SAM 은 Builder 플랜(45,000 쌤)인데
   SPUM Base 권한은 별개다. Studio UI 안에서 AI 를 쓰려면 Creator Pro 권한이 필요하다.
   이 리포의 프록시 + bake CLI 는 SAM 을 직접 호출하므로 이 제약과 무관하다.

## 시작

```bash
# .env 는 이미 생성돼 있다. SAM_API_KEY 를 실제 키(sam-...)로 바꾼다
pnpm verify        # 실제 호출로 연결 검증
```

### 환경 변수 파일

| 파일 | 커밋 | 용도 |
|---|---|---|
| `.env` | **X** | 실제 값. 키는 여기 한 곳에만 둔다 |
| `.env.local` | **X** | 기기별 override. `.env` 를 읽은 뒤 덮어쓴다 (지금은 전부 주석 처리된 stub) |
| `.env.example` | O | 형식 예시. 시크릿 없음 |

모든 스크립트가 `--env-file-if-exists=.env --env-file-if-exists=.env.local` 로
**둘 다** 읽는다. 같은 키가 양쪽에 있으면 `.env.local` 이 이긴다 — 그래서
`.env.local` 에 placeholder 를 남겨두면 `.env` 의 실제 키를 덮어써서 401 이 난다.
둘 중 하나만 써도 되고, 없으면 그냥 건너뛴다.

`.gitignore` 가 `.env` · `.env.local` · `.env.*.local` 을 막고 `.env.example` 만 통과시킨다
(`git check-ignore` 로 실증).

## 명령

| 명령 | 하는 일 |
|---|---|
| `pnpm doctor` | **막힌 곳 진단** — 키·모델·표면 축을 좁혀 원인 특정 (키 4개 병렬 아님, 순차) |
| `pnpm verify-keys` | 키 4개 각각 유효성 + 계정 현황 + 키별 월 한도 |
| `pnpm verify` | SAM 연결 검증 6단계 — 계정·모델·텍스트·구조화 JSON·SSE·NPC 커맨드 |
| `pnpm check-tiers` | 티어 매핑 정합성 (키 불필요, `GET /v1/models` 는 공개) |
| `pnpm models` | 모델 52개를 지연 낮은 순으로. `--image` 로 이미지 모델만 |
| `pnpm proxy` | SAM 프록시 기동 (`localhost:8787`) |
| `pnpm bake --config bake/example-world.json` | 월드 `bakedData` 생성 |
| `pnpm map --config bake/example-map.json --preview --html` | 레이아웃 설정 → Studio 맵 생성 |
| `pnpm fetch-theme` | SPUM 기본 맵 테마 수집 (야외 타일 20장, 로그인 불필요) |
| `pnpm tileset` | 실내 타일셋을 코드로 생성 (프로토타입 15장) |
| `pnpm tiles` | 타일 표 (`out/tile-picker.html`) — 테마가 있으면 테마를 |
| `pnpm assets` | CC0 타일 팩 다운로드 (Kenney, git 제외) |
| `pnpm import-tileset --spec <스펙>` | 외부 시트 → SPUM 테마 (여백 재포장·배율·영역 수집) |
| `pnpm ai-source --spec <스펙>` | Object 에디터 AI 생성용 소스 이미지 + 프롬프트 |
| `pnpm asset-snippet --backup <백업>` | 테마 타일 이미지를 브라우저에서 받는 스니펫 |
| `pnpm theme-from-backup --backup <백업>` | 백업의 맵 테마를 코드로 가져오기 |

## 구조

```
src/sam.mjs             SAM 클라이언트 — generate / stream / image / account, 에러·재시도
src/spum-map.mjs        맵 레코드 스키마 — 정규화·검증 (Studio 가 조용히 덮는 것을 먼저 잡는다)
src/spum-theme.mjs      맵 테마 — 타일 별칭·분류·이동 특성
src/png.mjs             최소 PNG 인코더 + 그리기 캔버스 (의존성 없음)
src/tile-art.mjs        실내 타일을 코드로 그린다 (프로토타입)
src/studio-snippet.mjs  맵만 넣는 콘솔 스니펫 (전체 교체를 피한다)
src/map-builder.mjs     레이아웃 설정(방·복도·문) -> 맵 레코드
src/map-preview.mjs     맵 레코드 -> 미리보기 HTML
src/studio-backup.mjs   Studio 백업 파일 읽기·병합 (불러오기는 병합이 아니라 전체 교체다)
src/tiers.mjs           light|medium|expert -> 실제 SAM alias 변환 (자체 프록시의 필수 조건)
src/baked-schema.mjs    bakedData v0.4 정규화·검증 (SPUM 이 조용히 버리는 항목을 먼저 잡는다)
server/sam-proxy.mjs    /api/sam/* 프록시 — 키 서버 보관, 티어 변환, SSE 통과, 쌤 누적 로그
scripts/verify-sam.mjs  실제 호출 검증
scripts/bake-world.mjs  SAM 으로 bakedData 생성 -> out/
scripts/make-map.mjs    맵 생성 CLI -> out/<slug>-studio-map.json
scripts/fetch-theme.mjs 기본 맵 테마 수집 -> out/themes/spum-default.json
scripts/make-tileset.mjs 실내 타일셋 생성 -> out/themes/proto-interior.json
scripts/tile-picker.mjs 타일 표 -> out/tile-picker.html
scripts/check-tiers.mjs 티어 매핑 검사
scripts/list-models.mjs 모델 카탈로그
web/spum-live-bootstrap.js  SPUM 런타임을 내 프록시로 돌리는 스니펫
bake/example-world.json     bake 설정 예시
bake/example-map.json       맵 레이아웃 예시 (서고 게임의 방 6개, 야외)
bake/proto-interior.json    실내 평면도 예시 (방 8개, 벽 공유)
```

## 두 레인

배포된 SPUM 월드는 **라이브 LLM 을 쓸 수 없다.** `world-viewer/viewer.js` 가
공개 재생 시 `conversationMode` 를 `baked` 로, `apiKey` 를 `''` 로 강제한다.
그래서 작업이 두 갈래로 나뉜다.

### 레인 A — Studio 안 (오소링 · 플레이테스트)

셋업 불필요. Studio 에서 월드 AI 설정의 `conversationMode` 를 `llm` 으로 바꾸면
라이브 대화 · 미션 매니저 · 캐릭터 디렉터가 전부 동작한다. Studio 가 자기 `/api/sam`
프록시를 쓰고 로그인 세션으로 인증하며, 비용은 내 SAM 계정에 청구된다.

캐스트별로 `aiRole { title, goal }` 과 `aiPolicy { obedience, autonomy, ... }` 를
채우는 것이 게임 설계의 실제 작업이다.

### 레인 B-1 — 공개 링크 + 큰 bakedData

```bash
cp bake/example-world.json bake/my-world.json
# sourceText 에 세계관·사건·인물을 길게 쓴다. 모델은 여기 없는 사실을 지어내지 않는다.
pnpm bake --config bake/my-world.json --detail rich --model expert
```

`out/<slug>-bakedData.json` 이 나온다. 이걸 월드의 `world.runtime.bakedData` 에 넣고
`conversationMode: "baked"` 로 publish 하면 공개 링크에서 재생된다.

생성 결과는 SPUM 의 import 규칙으로 미리 검증되어, 버려질 thread 와 그 이유를
바로 출력한다 (배치되지 않은 이름 사용 / participants 2명 아님 / turns 부족).

### 레인 B-2 — 자체 호스팅 + 라이브 LLM

```bash
pnpm proxy
```

그리고 월드를 띄운 페이지에서 (또는 Studio 탭의 DevTools 콘솔에서):

```js
globalThis.SPUM_WORLD_LLM_PROXY_URL = 'http://localhost:8787/api/sam/v1/generate';
```

SPUM 런타임은 이 전역을 **매 호출마다** 읽으므로 이미 열린 페이지에서도 즉시 반영된다.
프록시 URL 이 설정되면 런타임은 `X-API-Key` 를 아예 보내지 않는다 — 키는 서버에만 있으면 된다.

`web/spum-live-bootstrap.js` 가 이 설정 + 프록시 헬스체크를 대신 해준다.

> SPUM 엔진·런타임 파일을 내 도메인에서 서빙하는 것이 Creator Pro 라이센스
> 범위에 들어가는지는 확인되지 않았다. 공개 배포 전에 SoonSoon 에 문의해야 한다.

## 비용 관리

- Rate limit: **사용자 30 RPM / 키 20 RPM.** NPC 수 × 대화 빈도로 금방 닿는다.
  프록시가 `X-RateLimit-*` 헤더를 그대로 전달한다.
- 프록시가 매 응답의 `usage.scredits` 를 누적해 로그에 찍는다. `/healthz` 로도 확인.
- 프로젝트별 비용을 분리하려면 `sam.soonsoon.ai/api-keys` 에서
  **월 쌤 한도를 지정한 Custom Key** 를 따로 발급한다.
- 이미지는 런타임 생성보다 빌드타임 사전 생성 + 캐시가 낫다
  (`gpt-image-1-mini` $0.011/장, 3.5초).
