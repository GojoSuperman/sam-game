# SPUM Studio ↔ Claude Code — 무엇을 어디서 하나

조사·구현일 2026-08-19. **이 문서의 사실은 전부 실측이다** — 소스를 읽고, 실제로 호출하고,
파일을 왕복시켜 확인한 것만 적었다. 확인 못 한 것은 **미확인**으로 표시했다.

세부 스키마는 [SPUM 맵 스키마와 생성.md](SPUM%20맵%20스키마와%20생성.md),
SAM 쪽은 [SPUM SAM 연동 구조.md](SPUM%20SAM%20연동%20구조.md) 를 본다.

---

## 0. 한 장 요약

```
Studio          ─ AI 이미지 생성 · 픽셀 편집 · 캐스트 배치 · 퍼블리시
   ↓ 백업 JSON (+ 타일 이미지는 콘솔 스니펫으로 별도)
Claude Code     ─ 타일셋 재포장 · 레이아웃 생성 · 검증 · 주입 스니펫 생성
   ↓ 콘솔 스니펫
Studio          ─ 확인 · 저장 · 퍼블리시
```

**Studio 는 "그림과 배치의 손", Claude Code 는 "구조와 검증의 손".**
눈으로 안 보이는 것(연결성·갇힌 칸·형식 오류)은 코드가 잡고,
손으로 봐야 하는 것(그림 품질·배치 감각)은 Studio 에서 한다.

---

## 1. 모든 것을 규정하는 제약 두 개

### 1-1. 인증은 httpOnly 쿠키 세션뿐이다

```
GET /api/studio/state                        → 401 {"ok":false,"error":"login_required"}
GET /api/studio/state -H "X-API-Key: sam-…"  → 401 login_required
GET /api/studio/state -H "Authorization: …"  → 401 login_required
```

로그인은 `/auth/login` SSO 리다이렉트. **API 키로 들어가는 길이 없다.**
그래서 서버를 건드리는 일은 전부 브라우저 몫이다.
세션은 30분쯤에 만료된다 (`/api/me` 가 `{"user":null}` 이면 로그아웃).

### 1-2. localStorage 가 원본, 서버는 백업이다

| 방향 | 결과 |
|---|---|
| ❌ 서버에 직접 PUT | 다음 새로고침 때 **브라우저 로컬이 서버를 덮어씀** → 작업 소실 |
| ✅ localStorage 에 쓰고 → `saveServerSnapshot()` → 새로고침 | 정상 반영 |

**항상 `로컬 → 서버` 순서.** 반대로 하면 날아간다.

---

## 2. Studio 가 하는 일

| 섹션 | 하는 일 |
|---|---|
| **Cast** | 캐릭터 파츠 조합(카탈로그 753개) · 애니메이션 · `persona`/`aiConfig`/`talkConfig`/`memory` · 스프라이트 시트 추출 (`{이름}_idle.png` + `.json`) |
| **Map** | 타일맵 편집 · 레이어(back N / front N / walkable / obstacle) · 룰타일 · **타일 테마 여러 개**를 2048 간격 id 대역으로 물림 |
| **Object** | **맵 테마 제작소** — AI 이미지 생성 → 격자 슬라이스 → 자동 분류 → 픽셀 에디터 수정 |
| **World** | 캐스트 배치 · 월드 AI 설정(`conversationMode`) · 퍼블리시 |
| **AI Assistant** | 우측 채팅. 도구가 `character.*` + `world.*` **뿐** (`CHAT_TOOL_DOMAINS`) — 맵·오브젝트는 못 만지고 이미지 생성도 못 한다 |

### 2-1. Studio 만 할 수 있는 것 (코드로 대체 불가)

| 기능 | 실측 근거 |
|---|---|
| ~~**AI 이미지 생성**~~ | ~~`POST /api/ai-tiles/generate` → `503`~~ → **2026-08-20 브라우저 자동화로 해제. 9절 참조** (제약 자체는 그대로다 — 다만 브라우저를 코드가 몬다) |
| **AI 타일 분류** | `POST /api/ai-tiles/classify` — 같은 제약 |
| **에셋 저장소 읽기·쓰기** | `/api/studio/assets/<sha256>` — 쿠키 세션 필요 |
| **서버 저장** | 1-2 의 방향 규칙 |
| **캐스트 배치** | 코드로 배치 id 를 만들면 앱이 *"없는/중복 캐릭터 배치 N개를 정리했습니다"* 로 **전부 삭제**한다. World Editor 의 `+ → 배치` 버튼으로만 |
| **픽셀로 직접 그리기 · 퍼블리시** | UI 전용 |

### 2-2. Object 에디터의 맵 테마 파이프라인

```
소스 이미지 → (AI 생성) → 격자 슬라이스 → 자동 분류 → 타일셋
```

| 단계 | 컨트롤 (v1.5.0 화면) |
|---|---|
| 테마 이름 | `THEME NAME` |
| 짧은 한국어 컨셉 → 프롬프트 자동 작성 | `Concept` + `AI Prompt` 버튼 |
| 실제 프롬프트 | `Reference Prompt` (프리셋을 고르면 **덮어써진다** — 프리셋 건드리지 말 것) |
| 소스 이미지 업로드 | `Map Theme Settings` 의 `SOURCE` 썸네일 |
| 모델 · 품질 | `gpt-image` · `gpt-image-2` · `FLUX.2-pro` / `Low`·`Medium`·`High` |
| 격자 · 타일 크기 | `GRID` `16x16` / `TARGET` `32` |
| 실행 | `Generate` → `Slice` → `Classify` |
| 슬라이스 정렬 | `Slice` 패널의 `X`·`Y` 오프셋 |

**생성은 img2img 다.** `theme.source.imageDataUrl` 이 있으면 `body.referenceImage` 로
모델에 함께 넘어가 결과가 소스 구조를 유지한다. 프롬프트만으로는 매번 달라진다.

**슬라이스는 픽셀이 완전히 같은 조각만 합친다** (`_tileSignature`).
그래서 프롬프트가 결정적으로 중요하다:

| | 실패 | 성공 |
|---|---|---|
| 품질 | `low` — 넓게 깔 타일 0장 | **`high`** |
| 표현 | `seamless`·`edge-matching` 같은 추상어 | **"평평한 단색 면"** 을 구체적으로 요구 |
| 결과 | 256칸 → 161~173장으로 쪼개짐 | 256칸 → **4장** (2026-08-19 실측) |

성공한 문구 (2026-08-19, 지중해 바닥 4종을 사분면으로 한 번에 뽑음):

```
Every tile is a PLAIN FLAT COLOR FIELD filling the whole square edge to edge.
No borders, no frames, no objects, no furniture, no shadows, no gradients, no vignetting.
Only a very subtle material grain, almost uniform.
Keep the four quadrants as separate uniform fields with a hard edge between them.
Do not draw a scene. This is a material swatch chart.
```

비용: 품질 `high` 1024×1024 한 번에 **약 47쌤**.
`Classify` 는 타일이 이미 올바르게 붙었으면 **돌리지 말 것** — 분류기가 러그를 장애물로,
돌바닥을 `blocked` 로 잘못 붙인 사례가 둘 다 있다. 얻을 게 없으면 위험만 남는다.
분류는 **128장까지만** 처리된다 (`theme.tiles.slice(0, 128)`).

---

## 3. Studio 에서 나오는 데이터

`내 Studio 데이터 다운로드` = localStorage 키 뭉치 + IndexedDB 스냅샷.

| 키 | 내용 |
|---|---|
| `sv_studio_characters_v1` | 캐릭터 |
| `sv_studio_maps_v1` | 맵 (레이어·오브젝트·스폰·**타일셋**) |
| `sv_studio_smo_v1` | 오브젝트 / 맵 테마 |
| `sv_studio_draft_v1` · `draft_library_v1` | 월드 |
| `spum-map-theme-source-state:<id>` | 테마 편집기 작업본 — 프롬프트·슬라이스 결과·**192×192 썸네일** |
| `spum_indexeddb_snapshot:…themeStates` | 테마 라이브러리 (대용량, 실측 12.9MB) |

### 3-1. ★ 백업에 안 담기는 것 — 타일 이미지 원본

AI 로 만든 테마의 타일 이미지는 콘텐츠 해시 저장소로 외부화되고 `assetId` 만 남는다.
**맵에 타일셋으로 붙여도 안 담긴다** — `_stripBakedTilesetSheet` 가 `tiles[]` 가
비어 있지 않으면 `imageUrl` 을 지우기 때문이다 (2026-08-19 실측: `imageUrl: ''`).

빼내는 방법은 **콘솔 스니펫뿐**이다:

```bash
pnpm exec node scripts/asset-snippet.mjs --backup <백업.json> --theme "<테마 이름>"
```

백업에서 `sliceBaseAssetId`(AI 원본 1024×1024)와 타일별 `assetId` 를 찾아,
`/api/studio/assets/<id>` 를 fetch 해서 다운로드 폴더로 떨어뜨리는 스니펫을 만든다.
원본 1024×1024 한 장만 있으면 슬라이스는 코드에서 다시 하면 되므로 그게 제일 낫다.

> 크롬은 콘솔 첫 붙여넣기를 막는다 — `allow pasting` 을 타이핑하고 Enter.
> 그래도 안 되면 DevTools `Sources → Snippets → + New snippet` 에 붙여넣고 `Ctrl+Enter`.

### 3-2. 데이터를 코드로 가져오기

```bash
pnpm theme-from-backup --backup <백업.json> --key <이름>
```

두 경로를 순서대로 시도한다:
① 맵 `tilesets[]` 의 **구워진 시트(data URL)** — 손으로 만든 테마·기본 테마는 여기 있다
② 오브젝트 `mapTheme.tiles[].imageDataUrl` — 남아 있으면 시트를 직접 굽는다

AI 테마는 **둘 다 비어 있다** (3-1). 그때는 3-1 의 스니펫으로 이미지를 받아
`pnpm import-tileset` 으로 새 테마를 만든다.

---

## 4. Claude Code 가 하는 일

### 4-1. 맵 생성 (`pnpm map`)

레이아웃 JSON → SPUM 맵 레코드. 원시 요소:

| 요소 | 용도 |
|---|---|
| `rooms` | 방 — 벽·바닥·문(4방향, 폭). 사각형을 한 줄 겹치면 **벽 공유** |
| `areas` | 방 아닌 지형 — 중정·도랑·복도·둘레길. **방보다 먼저** 칠한다 |
| `overlays` | 같은 형태지만 **방·문보다 나중에** — 방 안의 못·욕조 |
| `corridors` | 벽을 덮어써 통로를 낸다 |
| `stamps` | 침대 2×2, 식탁 3×1 같은 **멀티타일 가구**. 벽에 걸치면 안 놓고 건너뛴다 |
| `nineSlices` | 테두리 있는 카펫 (모서리 4 · 변 4 · 중앙 1) |
| `scatter` | 숲처럼 결정적 흩뿌리기. `onTile` 로 다른 지형 침범 방지 |
| `props` | 단일 타일 소품 (`blocking` 지정 가능) |

타일 지정: 숫자 · 별칭 · `테마.별칭` · `#슬롯` · **배열**(좌표 해시로 섞음 — 같은 값을
여러 번 넣으면 그 비율로 나온다). 배열을 쓰는 이유는 같은 타일을 넓게 깔면
가장자리 처리 때문에 격자가 보이기 때문이다.

### 4-2. 검증 — 실제로 사고를 잡은 것들

| 검사 | 잡은 사고 (2026-08-19) |
|---|---|
| **연결성 flood fill** | 문 없는 방 · 조리대가 주방을 가로로 봉인(17칸) · 나무가 정원을 끊음(339칸) |
| **갇힌 칸** | 스폰이 없는 곳이라도 도달 불가 구역을 잡는다 |
| **스폰 자동 재배치** | 방 중앙이 가구에 덮인 경우 6건 — 방 안 가까운 통행 칸으로 옮기고 로그 |
| 필수 레이어 · `data` 길이 · 내비 0/1 · 타일 id 범위 | 형식 오류 |
| **테마 이동특성 충돌** | `movement: blocked` 인 타일을 바닥(walkable)으로 깐 경우 |
| **맨바닥 비율** | "휑함"을 숫자로. 분모는 **바닥 칸(벽 제외)** — walkable 로 재면 가구를 놓을수록 분모가 줄어 비율이 안 움직인다 (처음에 그렇게 재서 틀렸다) |

### 4-3. 타일셋

| 명령 | 하는 일 |
|---|---|
| `pnpm assets` | CC0 팩 다운로드 → `out/assets/` (git 제외) |
| `pnpm import-tileset --spec <스펙>` | 외부 시트 → SPUM 테마. **여백 재포장 필수** — SPUM 은 `TileSet` 에 `firstId` 만 넘기고 margin/spacing 을 안 준다. 1px 여백 시트를 그대로 쓰면 전부 어긋난다 |
| `pnpm tileset` | 코드로 타일 그리기 (프로토타입용, `src/tile-art.mjs`) |
| `pnpm fetch-theme` | SPUM 기본 테마 수집 — 공개 시드에서, **로그인 불필요** |
| `pnpm tiles` | 타일 표 HTML (별칭·분류·차단 표시) |
| `pnpm ai-source --spec <스펙>` | AI 생성용 소스 이미지 + 프롬프트 |

임포터의 `regions` 는 팩의 한 구역을 통째로 가져오고, 별칭을 `<접두사>_<원본열>_<원본행>`
으로 붙여 원본 좌표를 되짚을 수 있게 한다. 분류는 불투명도로 추정한다 (꽉 찬 타일은
바닥, 투명이 섞이면 사물).

**다중 테마**: `--theme` 를 여러 번 주면 2049 · 4097 · 6145 … 대역을 자동 배정한다.
별칭이 겹치면 앞선 테마가 이기고, `키.별칭` 으로 정확히 고른다.

### 4-4. 주입

| 방법 | 성격 |
|---|---|
| **`--snippet`** (권장) | `sv_studio_maps_v1` 키만 갈아끼우는 콘솔 스니펫. `spum:studio-storage-write` 이벤트 발생 + `saveServerSnapshot()` 까지 한다 |
| `--into <백업>` | Studio 백업 위에 맵만 얹은 파일 |
| `--standalone` | 단독 백업 파일 — **불러오면 전체 교체** |

> **2026-08-19 사고 기록.** `--into` 없이 만든 파일을 불러와 캐릭터 5명과 161장 테마가
> 날아갔다. 불러오기는 병합이 아니라 `replaceStudioData` 다. 그래서 지금은
> `--into` 나 `--snippet` 없이는 **파일을 아예 쓰지 않고** 오류로 중단한다.
> 서버 리비전 히스토리(`rev N → 다시 로드`)로 복구되지만, 파일 백업이 먼저다.

### 4-5. 미리보기·감사

HTML 미리보기(다중 시트 · `--scale` 배율 · walkable/obstacle 오버레이 · 구역 이름) ·
ASCII(`--preview`) · 백업 읽기(테마 추출 · 에셋 id 추출 · 데이터 감사).

### 4-6. SAM 쪽 (이전 세션)

프록시(`pnpm proxy`) · `bakedData` 생성(`pnpm bake`) · 연결 검증(`pnpm verify`, `doctor`).

---

## 5. 왕복 검증 결과 (2026-08-19)

코드로 만든 맵을 Studio 에 넣고 다시 내보내 **필드 단위로 비교했다 — 전부 일치**.

```
OK  레이어 5개 · back_1 1200 · back_2 233 · front_1 43 · walkable 930 · obstacle 270
OK  tileSetAssetId · tileIdBase 2049 · tileWidth/Height
OK  imageUrl 유지 (data URL 시트가 안 잘림)
OK  tileProperties 15개 · objects 8 · spawnPoints 8
```

**Object 에디터를 거치지 않고 만든 타일셋이 Studio 에서 정상 작동한다**는 뜻이다.
`tilesets[].imageUrl` 에 data URL 을 직접 박고 `tiles[]` 를 비워두면 유지된다.

---

## 6. 아직 안 해본 것

1. **캐릭터를 코드로 생성·편집** — 스키마는 확인했으나 실행 안 함
2. **월드 조립** — `bakedData` 파이프라인은 있으나 캐스트 배치는 UI 전용 (2-1)
3. ~~**브라우저 자동화**~~ — **2026-08-20 검증 완료. 8절 참조.**
4. **AI 테마를 쓴 맵의 왕복** — 프로토 타일셋으로만 검증했다 (5절)
5. **`/api/ai-tiles/*` 의 전체 응답 스키마** — `generate`·`classify` 요청은 확인, 응답 상세는 미확인

---

## 7. 실무 순서 (권장)

```
1. Studio: 데이터 다운로드            ← 항상 먼저. 안전망
2. Studio: Object 에서 AI 테마 생성 (품질 high, 평면 프롬프트)
   → Slice 결과가 40장 이하인지 확인 (아니면 오프셋 조정)
3. Studio: 콘솔에서 asset-snippet 실행 → 타일 이미지 받기
4. Code:   pnpm import-tileset → 테마 만들기
5. Code:   레이아웃 편집 → pnpm map --snippet --html → 미리보기 확인
6. Studio: 콘솔에 스니펫 붙여넣기 → 새로고침
   → 타일이 안 보이면 MAP STRUCTURE > Layers 의 NAV 체크박스(Block/Walk) 를 끈다
7. Studio: 확인 → 저장 → 필요하면 퍼블리시
```

---

## 8. 브라우저 자동화 (2026-08-20 실측)

1절의 제약("서버를 건드리는 일은 전부 브라우저 몫")을 **코드가 브라우저를 직접 몰아서** 푼다.
Playwright 로 로그인 프로필을 물린 Chromium 을 띄운다.

### 8-1. 셋업 (PC 당 1회)

```bash
npm i -D playwright
npx playwright install chromium
# 시스템 라이브러리 33개 — root 필요. sudo 가 막히면 WSL 안에서 이렇게:
/mnt/c/Windows/System32/wsl.exe -d Ubuntu -u root \
  <node 절대경로> <프로젝트>/node_modules/playwright/cli.js install-deps chromium
```

`wsl.exe -u root` 는 **비밀번호를 묻지 않는다** — sudo 비번을 모르는 상태에서도 통한다.
WSLg(`DISPLAY=:0`)가 살아 있어 headed 창이 화면에 그대로 뜬다.

### 8-2. 로그인 — 사람이 한 번, 그 뒤로는 코드가

```bash
npm run studio-login    # 창이 뜨면 사람이 SSO 로그인
```

프로필은 `.browser/profile` (gitignore. **로그인 쿠키가 들어간다**).

| 쿠키 | httpOnly | 만료 |
|---|---|---|
| `spum_session` | true | **+30일** (2026-08-20 로그인 → 2026-09-19) |

**세션 쿠키가 아니다.** 창을 닫았다 headless 로 다시 열어도 로그인이 유지되는 것을
왕복으로 확인했다. 1-1 의 "30분쯤 만료"는 이 쿠키 얘기가 아니었다.
→ **로그인 1회로 한 달간 headless 자동화가 된다.**

### 8-3. 함정 — SSO 리다이렉트가 탭을 갈아탄다

로그인은 SoonSoon ID 로 리다이렉트되고, **Studio 는 새 탭으로 열린다.**
원래 탭은 다른 오리진에 남는다. 그 탭에 대고 `fetch(studio/api/me)` 를 하면
**CORS 로 막혀 조용히 실패**해서 "로그인 안 됨" 으로 보인다 (실제로 이걸로 3분 헤맸다).

→ `findStudioPage(context)` 로 **오리진이 맞는 탭을 골라야 한다.**
`checkSession()` 은 오리진이 다르면 `wrongOrigin` 을 담아 돌려준다 (조용한 실패 금지).

### 8-4. 세션은 지켜야 한다 — 잃으면 사람 손이 필요하다

**2026-08-20 사고.** 정찰 스크립트가 `goto` 타임아웃으로 죽으면서 `context.close()` 를
안 하고 `process.exit(1)` 했다. 크롬이 강제 종료되며 **이미 들어와 있던 `spum_session` 까지
날아갔다.** 크롬은 쿠키를 즉시 디스크에 쓰지 않는다.

되살릴 방법이 없었다. `id.soonsoon.ai` 의 `id_access`·`id_refresh` 는 남아 있었지만
`/auth/login` 은 그대로 로그인 화면으로 떨어진다 (12초 기다려도 자동 진행 없음).
SSO 가 **이메일 매직링크**(`Send login link`) 라 사람이 메일을 열어야 한다.

→ 그래서 세 겹으로 막았다:

| 대책 | 위치 |
|---|---|
| `withStudio(opts, fn)` — `finally` 에서 **반드시** close | `src/studio-browser.mjs` |
| `.browser/session.json` — 쿠키를 프로필 **밖에** 한 벌 더 (0600) | `saveSession()` |
| 열 때 `spum_session` 없으면 백업에서 자동 주입 | `openStudioContext()` |

**모든 자동화는 `withStudio()` 로 감싼다.** 직접 `openStudioContext()` 를 쓰면 이 사고가 반복된다.

### 8-4-b. ★ 진짜 원인은 따로 있었다 — 프로필 동시 점유

한나절 동안 세션·localStorage 가 계속 사라졌다. 위의 대책을 다 넣고도 반복됐다.
원인은 **`npm run studio-open` 으로 띄운 창을 열어둔 채 다른 스크립트를 돌린 것**이었다.

같은 `--user-data-dir` 을 두 크롬이 잡으면 나중 것이 *"기존 브라우저 세션에서 여는 중입니다"* 로
붙어버리고, **그 세션이 쓴 내용은 어디에도 남지 않는다.** 증상이 전부 여기서 나왔다:

| 증상 | 실제 원인 |
|---|---|
| localStorage 가 매번 빔 | 프로필 점유 |
| `saveServerSnapshot()` → `false` | 프로필 점유 |
| 쿠키가 프로필에 안 남음 | 프로필 점유 |

창을 닫자 곧바로 `spum_session` 이 프로필에 남았고 리비전도 올라가기 시작했다.

→ `findProfileHolders()` 로 **시작 전에 검사하고, 점유 중이면 pid 를 알리며 즉시 중단**한다.
조용히 이상하게 도는 것보다 훨씬 낫다. (`openStudioContext` 에 내장)

### 8-5. 무엇을 어떻게 조작하나 (섹션별 정찰 결과)

**URL 로 직접 간다.** 네비 클릭보다 안 깨진다:

```
/studio/?section=world | map | object | character
```

**섹션에 들어가도 새 전역은 0개다.** 에디터를 함수로 부르는 길은 없다.
그리고 섹션 전환에 `/api/*` 호출이 없다 — 전부 localStorage 가 원본이고
서버는 스냅샷만 받는다 (1-2 의 방향 규칙과 정확히 일치).

그래서 조작 경로는 둘뿐이다:

| 경로 | 쓸 곳 | 안정성 |
|---|---|---|
| **localStorage 쓰기 + `saveServerSnapshot()`** | 맵 · 오브젝트 · 캐릭터 — 스키마를 아는 것 전부 | 높음 (UI 변경과 무관) |
| DOM 클릭 | AI 생성 · 캐스트 배치 · 퍼블리시 — UI 전용 기능 | 낮음 (UI 바뀌면 깨짐) |

전역은 대시보드에 붙는 것이 전부다:

| 전역 | 메서드 |
|---|---|
| `spumStudioData` | `saveServerSnapshot` · `export` · `import` · `loadSeed` · `saveBeforePublish` · `hasLocalData` · `clearLocal` · **`listEmergencyBackups`** · **`restoreEmergency`** |
| `spumStudioNotifications` | `notify` `info` `success` `warning` `error` `popup` `confirm` `onAction` `dismiss` |
| `spumColorTilesets`(4) · `spumGetColorTileset` · `spumSetColorTileset` | 색 테마 |

★ **`spum_studio_emergency_backup_<ts>`** — Studio 가 localStorage 에 자동으로 남기는
비상 백업이다 (실측: 3벌, 각 533KB). `restoreEmergency(id)` 로 되돌린다.
문서에 없던 안전망이니 사고 때 먼저 확인할 것.

섹션별 화면 접점 (2026-08-20, v1.5.0):

| 섹션 | canvas | 눈에 띄는 버튼 |
|---|---|---|
| Map | `studio-map__canvas` 960×720 · `__minimap-canvas` 130×94 · 254×254(팔레트) | `Rule Tile` `Layers` `Apply` `Reset` `Shortcuts` |
| World | `world-page__map-canvas` · `__unit-canvas` · `__front-canvas` (각 791×721) | `캐스트 배치` `베이크` `스토리` `미션` `시뮬레이션` `Play` `SPUM Link` |
| Object / Cast | 없음 (목록 화면) | `+ New Character` |

`data-*` 속성이 상단바·계정 다이얼로그에 촘촘하다 (`data-topbar-ssam`,
`data-account-dialog-save-snapshot` 등) — 셀렉터로 쓸 만하다.

### 8-6. 데이터 스키마 (백업 실측)

`sv_studio_smo_v1` 의 항목은 두 종류다:

| 종류 | 특징 |
|---|---|
| **내장 지형** (초원·흙길·진흙·돌벽·얕은 물) | `visual.pixels` 에 16×16=256색 배열, `mapTheme: null`, `builtin: true` |
| **맵 테마** (Custom SMO 1·2) | `mapTheme.tiles[]` 에 타일 정의, `builtin` 없음 |

공통 필드: `id` `key` `name` `category` `layerHint` `size{cols,rows}` `visual`
`collision{blocksMovement,blocksVision}` `terrain{type,moveSpeed,staminaCost,footstep,damagePerSecond}`
`interaction{kind,prompt}` `tags[]` `mapTheme` `meta{createdAt,updatedAt}`

`mapTheme` : `version` `id` `name` `type` `grid` `tileSize` `prompt` `imageModel`
`quality` **`sliceBaseAssetId`** `source` `tiles[]` `editorState`

`mapTheme.tiles[i]` : `id` `name` `category` `movement` `interaction` `role`
`count` `cells[{column,row}]` `imageDataUrl` **`assetId`** `confidence` `order`

3-1 이 그대로 재현됐다 — `Custom SMO 2`(AI 테마, 4장)는 `imageDataUrl` 이 **0/4**,
`assetId` 는 **4/4**. 백업만으로는 이미지를 복원할 수 없다.

### 8-7. 검증된 것 / 아직 아닌 것

| | 상태 |
|---|---|
| 세션 유지 (창 닫고 headless 재개) | ✅ |
| `/api/me` 로 로그인 확인 | ✅ `<계정 이메일>` |
| localStorage 읽기 | ✅ `sv_studio_maps_v1` 278KB · `sv_studio_smo_v1` 178KB |
| headless 스크린샷 | ✅ 로그인 상태로 렌더 (`서버 Studio 저장소 연결됨 · rev 33`) |
| localStorage **쓰기** + `saveServerSnapshot()` | ✅ **왕복 검증 완료 (2026-08-20)** — 아래 8-10 |
| 에셋 다운로드 (3-1 의 콘솔 스니펫 대체) | ✅ **`npm run studio-assets -- --theme "<이름>"`** — `Custom SMO 2` 원본 1024²(1.3MB) + 타일 4장 수신 성공. 콘솔 스니펫 불필요 |
| AI 타일 생성 (2-1) | 미검증. **호출마다 실제 비용**(high 1024² ≈ 47쌤)이라 루프 금지 |
| 캐스트 배치 (2-1) | 미검증. 좌표 클릭이라 UI 가 바뀌면 깨진다 |

### 8-8. 이걸로 뭐가 달라지나

콘솔에 손으로 붙여넣던 스니펫(3-1 · 4-4)이 `page.evaluate()` 한 줄이 된다.
`allow pasting` 타이핑도, DevTools Snippets 도 필요 없다.
그리고 **결과를 스크린샷으로 직접 확인할 수 있다** — 타일이 어긋났는지 사람이 봐주지 않아도 된다.

단, 쓰기는 여전히 **1-2 의 방향 규칙**(로컬 → 서버)을 따라야 하고,
파일 백업(7절 1번)을 먼저 받아두는 원칙도 그대로다.

### 8-9. 명령 정리

| 명령 | 하는 일 | 위험 |
|---|---|---|
| `npm run studio-login` | 창을 띄워 사람이 로그인. 세션을 프로필+파일에 저장 | 없음 |
| `npm run studio-probe` | 백업 + 전역·API 정찰 | 없음 (읽기) |
| `npm run studio-sections` | 섹션별 전역·DOM·API + 스크린샷 | 없음 (읽기) |
| `npm run studio-assets -- --theme "<이름>"` | 테마의 원본·타일 이미지 내려받기 | 없음 (읽기) |
| `npm run studio-apply -- --map <맵.json> [--dry-run]` | 맵 주입 + 서버 스냅샷 + 스크린샷 | **쓰기** — 자동 백업하지만 `--dry-run` 먼저 |
| `npm run studio-open [-- --section map]` | 창을 띄워 사람이 확인 | 없음 — 단 **다 보면 창을 닫을 것** (열어두면 다른 작업이 전부 막힌다, 8-4-b) |
| `npm run studio-restore [-- --from <백업>]` | 서버(또는 백업 파일) → 로컬 복원 | **쓰기** — 로컬을 덮는다 |
| `npm run studio-ai-theme -- …` | AI 타일·씬 생성 (9절·10절) | **과금** — `--generate` 없이는 설정만 |
| `node scripts/scene-to-map.mjs …` | 조감도+마스크 → 맵 레코드 (10절) | 없음 (로컬 파일만) |

### 8-10. 주입 왕복 검증 (2026-08-20)

시험용 맵(`bake/inject-test.json`, 20×15, 방 2개)을 코드로 만들어 주입했다.

```
node scripts/make-map.mjs --config bake/inject-test.json --into <백업> --out out/inject-test-studio-map.json
npm run studio-apply -- --map out/inject-test-studio-map.json --name "주입 시험 맵" --dry-run
npm run studio-apply -- --map out/inject-test-studio-map.json --name "주입 시험 맵"
```

| 확인 | 결과 |
|---|---|
| 맵 목록 | `주입 시험 맵 20×15 · 5레이어` 추가, **`맵 2` 그대로** |
| 레이어 | `back_1` `back_2` `front_1` `walkable` `obstacle` 5개 전부 |
| `saveServerSnapshot()` | `true` |
| 서버 리비전 | **rev 33 → rev 34** |
| 새로고침 후 | 유지됨 |
| 화면 | 방 2개와 잇는 문이 오버레이 아래로 정확히 보임 (ASCII 미리보기와 일치) |
| `tilesets[0]` | `tileIdBase: 2049` · `imageUrl` data URL 유지 · `tiles: 0` — 5절 규칙 그대로 |

**사람이 콘솔에 아무것도 붙여넣지 않았다.** 4-4 의 스니펫 경로가 완전히 대체됐다.

곁다리 확인 두 가지:
- **DOM 클릭은 역시 약하다.** NAV 오버레이 체크박스를 끄려다 셀렉터가 빗나가 실패했다
  (8-5 의 "DOM 경로 안정성 낮음" 이 실측으로 확인된 셈).
- 타일 **외형**은 기본 테마(사막 톤)를 따라간다. 주입과는 무관한 별개 문제 —
  `--theme` 로 테마를 지정하는 쪽에서 다룰 일이다.

---

## 9. AI 타일 생성 자동화 (2026-08-20 실측)

2-1 에서 "Studio 만 할 수 있는 것" 1순위였던 AI 이미지 생성을 **코드가 끝까지 몰았다.**
사람은 로그인 말고 아무것도 하지 않았다.

```bash
npm run studio-ai-theme -- --open "<오브젝트>" --name "<테마>" \
  --prompt bake/prompts/ship-floors.txt --generate --slice
```

### 9-1. ★ 에디터 UI 는 iframe 안에 있다

`page.waitForSelector('#resourceThemeNameInput')` 가 계속 타임아웃 났다.
요소는 화면에 멀쩡히 보이는데 **메인 프레임에 없다.**
`page.frames()` 를 순회해 해당 프레임을 찾아야 `fill`·`selectOption`·`click` 이 먹는다.
(`frameWith(page, selector)` 헬퍼로 굳혔다.)

목록 항목도 `text=<이름>` 이 아니라 **`.spum-resource-list__name`** 을 눌러야 열린다.

### 9-2. 셀렉터 (v1.5.0, 전부 id — DOM 클릭치고 안정적이다)

| 용도 | 셀렉터 |
|---|---|
| 새 오브젝트 | `[data-object-action="create"]` |
| 테마 이름 · 컨셉 · 프롬프트 | `#resourceThemeNameInput` · `#resourceConceptInput` · `#resourcePromptInput` |
| 프리셋 ★건드리지 말 것 | `#resourcePresetSelect` (Desert/Forest/Ice/Dungeon) |
| 모델 · 품질 | `#resourceModelSelect` (gpt-image-2/gpt-image/FLUX.2-pro) · `#resourceQualitySelect` |
| **생성** | `#resourceGenerateButton` |
| 슬라이스 · 오프셋 | `#sliceReferenceButton` · `#sliceOffsetXInput` · `#sliceOffsetYInput` |
| 분류 ★쓰지 말 것 | `#classifyTilesButton` |
| 테마 타입 · 타일크기 · 격자 | `#themeTypeSelect` · `#themeTileSizeSelect` · `#themeGridSelect` |
| 소스 이미지 | `#themeSourceButton` |
| 슬라이스 결과 카드 | `.slice-resource-card` |

### 9-3. 비용 — 문서의 47쌤이 아니었다

`gpt-image-2` + `high` + 1024² 한 번에 **125쌤** (44,900 → 44,775 실측).
2-2 의 47쌤과 다르다. 모델이나 요금이 바뀐 듯하니 **호출 전후로 잔액을 찍어 확인할 것.**

### 9-4. 결과 — 우주선 바닥 4종

프롬프트는 2-2 의 성공 문구를 재질만 바꿔 옮겼다 (`bake/prompts/ship-floors.txt`).
결과 1024² 는 사분면이 정확히 갈렸고 **각 사분면이 8×8 패널 = 1셀(64px) 에 정확히 정렬**됐다.
슬라이스 오프셋 조정이 필요 없었다.

슬라이스는 **63장** 이 나왔다 (목표 40 이하는 못 맞췄지만 2-2 의 실패 사례 161~173장 과는 다르다).
사분면 안에서 리벳 위치가 미세하게 달라 갈린 것이라, 넓게 깔 타일은 충분했다.

### 9-5. 에셋 내려받기 중 401

63장을 받는 도중 **세션이 끊겨 8장이 401** 로 실패했다 (15분 주기, 8-4 참조).
원본 1024² 한 장은 받았고, 3-1 이 적어둔 대로 **원본만 있으면 코드로 다시 자르면 된다.**

### 9-6. 코드로 재포장할 때 걸린 것 둘

| 함정 | 내용 |
|---|---|
| **축소 불가** | `import-tileset` 은 `outTileSize` 가 `srcTileSize` 의 정수배여야 한다. AI 원본은 셀 64px 인데 목표는 32px — **먼저 1024²→512² 로 줄여** 셀을 32px 로 맞췄다 |
| **별칭 변형 규칙이 다르다** | `make-tileset` 은 `alias: "deck:1"` 을 쪼개 배열에 넣지만, `import-tileset` 은 `"deck:1"` 을 **별칭 그대로** 쓴다. `make-map` 의 `별칭:N` 은 배열 인덱스라서 안 맞는다 → 스펙에 **같은 별칭을 4번 반복**해야 `deck:1~3` 이 작동한다 (지중해 스펙이 쓰던 방식) |

### 9-7. 하이브리드가 답이었다

| 층 | 출처 | 이유 |
|---|---|---|
| **바닥** (면적 대부분) | AI 생성 (`shipai`, id 2049~) | 재질감이 필요하고, 균일한 면이라 AI 가 잘 만든다 |
| **벽 · 설비** | 코드 (`ship`, id 4097~) | 형태가 있어야 해서 "평평한 단색 면" 프롬프트와 충돌한다 |

`--theme` 를 두 번 주면 2048 간격으로 대역이 갈린다. 레이아웃에서는 `shipai.deck` ·
`ship.hull` 처럼 **`키.별칭`** 으로 정확히 지목했다 (양쪽에 같은 별칭이 있다).

결과: 함교·의무실은 밝은 세라믹, 복도·승무원실은 리벳 갑판, 화물칸은 갈색 강판,
기관실은 통풍 격자. 코드 타일만 쓰던 판(전부 어두운 청회색)과 비교가 안 된다.

---

## 10. 조감도 한 장을 맵으로 (2026-08-20)

타일을 반복해 까는 방식으로는 "완성된 씬" 이 안 나온다.
진열대마다 내용이 다르고 그림자와 원근이 있는 그림은 **씬 전체를 한 장으로 그려야** 한다.

| | 타일 방식 (4절) | 씬 방식 (이 절) |
|---|---|---|
| AI 에 요구 | 균일한 재질 몇 종 | **완성된 조감도 한 장** |
| 격자 | 16×16 (셀 64px) | **32×32 (셀 32px)** |
| 조각 | 4~63장, 반복해서 깐다 | **1024장 전부 고유**, 원좌표에 복원 |
| 재사용 | 여러 맵에 | 그 맵 전용 |

### 10-1. ★ 핵심 — 그림과 마스크를 **쌍으로** 뽑는다

그림에는 "어디를 걸을 수 있는지" 정보가 없다. 픽셀로 추정해 봤지만 **실패했다**:

```
바닥으로 확실한 칸: mean 77 · 76 · 110 · 105 · 86
설비로 확실한 칸:  mean 53 · 32 · 63 · 82 · 81      ← 완전히 겹친다
결과: 통행 0칸
```

전체가 어두운 그림이라 밝기·채도·편차 어느 것으로도 갈리지 않는다.

**해법은 AI 에게 마스크도 그리게 하는 것이다.** 2-2 의 img2img 를 그대로 쓴다 —
방금 만든 조감도를 SOURCE 로 넣으면 `referenceImage` 로 넘어가 **구조가 유지된다.**

```
Convert the reference floor plan into a flat two-tone navigation mask, same layout and same grid alignment.
Pure WHITE for every walkable floor tile the crew can stand on.
Pure BLACK for everything blocked: walls, bulkheads, consoles, machinery, beds, tables, chairs, crates, planters, the reactor, pipes.
Hard edges, no anti-aliasing, no grey, no gradients, no shadows, no text, no icons.
Keep the exact same shapes and positions as the reference. Square image on a 32x32 grid.
```

결과를 원본에 포개어 확인했다 — 침상·병상·콘솔·반응로·식탁·화물상자·화분이
**전부 정확히 막힘으로 잡혔다.** 통행 558칸 / 막힘 466칸.

### 10-2. SOURCE 업로드 (img2img 의 입구)

`#themeSourceButton` 은 파일 다이얼로그가 아니라 **라이브러리 모달**을 연다.
`filechooser` 를 기다리면 타임아웃 난다 (`.modal-backdrop#sourceLibraryDialog` 가 클릭을 가로챈다).

```
① ed.click('#themeSourceButton')          모달 열기
② ed.setInputFiles('#sourceImageFileInput', <파일>)
③ ed.click('#applyThemeSourceButton')     "Use Source"
```

**참조 이미지는 줄여서 넣는다.** 1024²(1.7MB) 를 그대로 주면 `413 Payload Too Large`.
512²(625KB) 로 줄이면 통과한다 — 구조만 유지되면 되므로 화질은 문제되지 않는다.

### 10-3. 프롬프트 길이가 504 를 가른다

1099자 프롬프트에서 `504 Gateway Timeout` 이 났다. 구역 배치는 남기고 재질·스타일 설명을
압축해 **480자**로 줄이니 안정적으로 성공했다 (`bake/prompts/ship-scene-short.txt`).

### 10-4. localStorage 한도 — 여기서 두 번 막힌다

실측: 한도 **약 5MB**, 이미 4,589KB 사용 중 (여유 512KB).
가장 큰 항목은 맵이 아니라 **테마 편집기 작업본**이었다:

```
spum-map-theme-source-state:SMO_BUILTIN_STONE_WALL   2,842KB   ← 돌벽 테마 작업본
spum_studio_emergency_backup_…                          533KB
sv_studio_maps_v1                                       356KB
```

맵 하나를 넣으려고 두 가지를 했다:

| 조치 | 효과 |
|---|---|
| 시트를 **JPEG q68** 로 굽기 (`--jpeg 68`) | PNG 2.3MB → **201KB** |
| `tileProperties` 를 Studio 가 읽는 필드만 남기기 | 1024칸이라 필드 하나가 곧 수십 KB |
| 비상 백업 1벌 삭제 | 533KB 확보 |

결과 맵 레코드 **520KB**. 2,794KB 였던 것이 5분의 1이 됐다.

> 픽셀아트라면 JPEG 아티팩트가 문제지만, 이건 사실적 일러스트라 q68 에서도 눈에 띄지 않는다.

### 10-5. 명령

```bash
# ① 씬 생성 (약 125쌤)
npm run studio-ai-theme -- --name "우주선 조감도" \
  --prompt bake/prompts/ship-scene-short.txt --grid 32x32 --target 32 --generate

# ② 참조본 축소 후 마스크 생성 (약 125쌤) — 512² 로 줄여야 413 을 피한다
npm run studio-ai-theme -- --name "우주선 조감도 마스크" \
  --prompt bake/prompts/ship-mask.txt --source out/assets-studio/조감도-ref-512.png \
  --grid 32x32 --target 32 --generate

# ③ 그림 + 마스크 → 맵
node scripts/scene-to-map.mjs --image <조감도.png> --maskimage <마스크.png> \
  --name "우주선 조감도" --jpeg 68 --mask

# ④ 주입
npm run studio-apply -- --map out/scene-map.json --name "우주선 조감도"
```

`--mask` 를 주면 `out/scene-walkmask.png` 에 판정 결과를 원본 위에 칠해 준다 (초록=통행).
**주입 전에 이걸 눈으로 확인하는 게 좋다.**

### 10-6. 결과와 남은 것

`32×32 · 5레이어 · rev 49` 로 들어갔고, 원본 일러스트가 그대로 렌더된다.

다만 **통행 558칸 중 서로 이어진 것은 361칸**이고 197칸은 고립됐다
(`scene-to-map` 이 최대 연결 덩어리만 남기고 나머지는 막는다 — 갈 수 없는 곳을
갈 수 있다고 표시하면 안 되기 때문이다). 설비가 통로를 끊은 지점을 마스크에서
손보면 전체가 이어진다.

★ **그림이 생성되면 즉시 파일로 확보한다.** 이 파이프라인에서 그림은 비용이 든 산출물이고,
Studio 로컬은 언제 날아갈지 모른다. `studio-ai-theme` 는 route 프록시 · SMO 덤프 ·
응답 base64 스캔의 3중으로 받아 `out/assets-studio/` 에 떨군다.
(이걸 안 해서 조감도를 세 번 잃었다.)
