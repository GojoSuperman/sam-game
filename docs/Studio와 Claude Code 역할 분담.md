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
| **AI 이미지 생성** | `POST /api/ai-tiles/generate` → `503 "SPUM login session or local SAM_API_KEY is required"`. `withStudioApiKey()` 는 빈 함수 — 클라이언트 API 키 경로가 아예 없다 |
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
3. **브라우저 자동화** — Playwright 로 세션을 잡아 AI 생성까지 자동화. 가능해 보이나 미검증
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
