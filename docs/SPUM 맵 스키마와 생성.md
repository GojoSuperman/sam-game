# SPUM 맵 — 스키마와 프로그래밍 생성

조사일 2026-08-19. 근거는 `spum.soonsoon.ai` 가 실제로 서빙하는 소스와 실호출 결과다.
확인 못 한 것은 **미확인**으로 적었다.

---

## 1. 맵을 만드는 서버 API 는 없다

찾은 서버 엔드포인트 전부:

| 엔드포인트 | 용도 |
|---|---|
| `GET /api/me` · `/api/access-log` | 세션 |
| `GET/PUT /api/studio/state` | Studio **전체 상태 blob** 동기화 (revision + hash 충돌 제어) |
| `GET /api/studio/storage` | 용량 |
| `/api/studio/revisions[/:rev/restore]` | 리비전 히스토리 |
| `/api/studio/published-worlds/:id/restore` | 퍼블리시 복원 |
| `/api/sam/*` · `/api/ai-tiles/*` · `/api/worlds/*` | AI 프록시 · 타일 · 월드 |

맵/오브젝트/캐릭터의 리소스 CRUD 는 **없다**. `/api/studio/state` 는 리소스 API 가 아니라
localStorage + IndexedDB 키 뭉치를 통째로 밀어넣는 스냅샷 동기화다.

인증도 쿠키 세션뿐이다 (실측):

```
GET /api/studio/state                          → 401 {"ok":false,"error":"login_required"}
GET /api/studio/state  -H "X-API-Key: sam-…"   → 401 login_required
GET /api/studio/state  -H "Authorization: …"   → 401 login_required
```

로그인은 `/auth/login` SSO 리다이렉트 + httpOnly 쿠키다. **API 키로 들어가는 길이 없다.**
(SAM API 쪽에 월드 데이터 경로가 없다는 건 `SPUM SAM 연동 구조.md` 11-5 에 별도 기록.)

그래서 이 리포는 **데이터 파일을 만들어 Studio 로 불러오는** 방식을 쓴다.

---

## 2. 맵이 사는 곳

| 항목 | 값 |
|---|---|
| 저장소 | **localStorage** (IndexedDB 아님) |
| 키 | `sv_studio_maps_v1` |
| 형태 | 맵 레코드 **배열**을 `JSON.stringify` 한 문자열 |
| 백업 대상 | `StudioPersistence.STUDIO_BACKUP_EXACT_KEYS` 에 포함 → 내보내기/불러오기 됨 |
| 서버 동기화 | 포함 (`sv_studio_thumb_` 접두사만 제외) |

같은 계열의 다른 키:

| 키 | 내용 |
|---|---|
| `sv_studio_characters_v1` | 캐릭터(Cast) |
| `sv_studio_smo_v1` | 오브젝트(SMO = 맵 셀 오브젝트) |
| `sv_studio_draft_v1` · `sv_studio_draft_library_v1` | 월드 |
| `sv_studio_thumb_*` | 썸네일 (서버 동기화 제외) |

### 백업 파일 형식

`window.spumStudioData.export()` 가 내놓는 것과 같은 형태여야 불러오기가 받는다.

```json
{
  "type": "spum-studio-local-backup",
  "version": 1,
  "exportedAt": "2026-08-19T02:00:00.000Z",
  "activeSection": "map",
  "keys": { "sv_studio_maps_v1": "…JSON 문자열…" }
}
```

`keys` 의 값은 **반드시 문자열**이다 (`normalizeStudioBackupPayload()` 가 객체면 다시 stringify 하지만,
문자열로 넣는 편이 왕복이 안전하다).

> ★ **불러오기는 병합이 아니라 전체 교체다** (`importStudioDataFromFile` → `replaceStudioData`).
> 맵만 든 파일을 그냥 불러오면 캐릭터·오브젝트·월드가 사라진다. 반드시 Studio 에서 먼저
> 내보낸 백업 위에 얹어야 한다 — `make-map --into <백업.json>` 이 그 일을 한다.

---

## 3. 맵 레코드 스키마

`MapStore._normalize()` 가 저장·조회 양쪽에서 돌기 때문에, 여기 없는 필드는 버려지고
형식이 틀린 필드는 조용히 기본값으로 덮인다.

```jsonc
{
  "id": "MAP_mszg3jgs_CAYS",       // MAP_<base36 시각>_<대문자 4자>
  "name": "서고의 밤",
  "description": "",
  "version": 1,
  "width": 40, "height": 30,       // 타일 수
  "tileSize": 32,                  // px
  "tileSetAssetId": "builtin_tp_tile01",
  "mapThemeId": "",
  "savedAt": "2026-08-19T…",
  "layers": [ /* 아래 */ ],
  "objects": [ /* 구역 메타 */ ],
  "ruleTiles": {},                 // 타일 id → 룰타일 정의
  "tilesets": [],                  // 비워두면 내장 타일셋만 (mergeTileSetLibrary 가 항상 주입)
  "spawnPoints": [ { "x": 9, "y": 6, "label": "서고" } ],
  "meta": { "createdAt": "…", "updatedAt": "…", "tags": [] }
}
```

### 레이어

```jsonc
{ "name": "back_1", "type": "back", "label": "지면", "data": [ /* width×height 개 */ ] }
```

- `data` 는 **평탄 배열**, 인덱스 `row * width + col`. (구형 `rows` 2차원도 읽어주지만 저장은 평탄형)
- 타입 4종: `back`(캐릭터 아래) · `front`(캐릭터 위) · `walkable` · `obstacle`
- 이름 규칙: `back_N` · `front_N` · `walkable` · `obstacle`.
  구형 이름은 자동 변환된다 — `ground`→`back_1`, `detail`→`back_2`, `objects`→`front_1`, `collision`→`obstacle`
- **필수 4개** (`back_1` · `front_1` · `walkable` · `obstacle`) 는 없으면 Studio 가 빈 것으로 만들어 붙인다
- 저장 순서는 **back… → front… → walkable → obstacle** 로 강제된다 (`groupNormalizedLayers`)
- ★ `walkable` / `obstacle` 의 값은 **타일 id 가 아니라 0/1 플래그**다
  (`MapWorkspace._paintAtTile` 이 내비 레이어에는 항상 `1` 을 찍는다)

톱다운에서 벽은 `back_2` 에 두는 편이 낫다. `front` 에 두면 캐릭터가 벽 뒤로 가려진다.

### 맵 테마 — Object 에디터에서 만드는 타일셋

내장 타일셋 말고, **Object 섹션에서 만든 맵 테마**를 타일셋으로 쓸 수 있다. 그쪽이 정규 경로다.

| 단계 | 실제 |
|---|---|
| 소스 시트 | `theme.source.imageDataUrl` — 기준 이미지를 올린다 |
| AI 생성(선택) | `POST /api/ai-tiles/generate` · `mode:'concept-map'` · `gpt-image`/`gpt-image-2`/`FLUX.2-pro` · 1024×1024 |
| 슬라이스 | 그리드 `8x8`·`10x10`·`16x16`·`32x32`, 타일 16/32/64px |
| 분류 | `POST /api/ai-tiles/classify` → `category`(floor/obstacle_blocking/obstacle_slowing/item/decoration) + `movement`(passable/blocked/slowed) |
| 저장 | 타일 이미지는 `/api/studio/assets` (sha256 콘텐츠 해시) |
| 맵에서 사용 | `createTileSetAssetFromMapTheme` 가 조각을 한 장으로 굽는다 |

AI 호출 두 개는 **브라우저 로그인 세션이 필요하다** (실측: `POST /api/ai-tiles/generate` →
`503 "SPUM login session or local SAM_API_KEY is required"`). `withStudioApiKey()` 는 빈 함수라
클라이언트 API 키 경로가 아예 없다. 단 **AI 없이도 된다** — 가진 시트를 올려 슬라이스하고
분류를 손으로 지정하면 AI 호출이 0회다.

구워진 테마 타일셋은 맵 레코드의 `tilesets[]` 에 이렇게 저장된다:

```jsonc
{
  "id": "theme_SMO_BUILTIN_STONE_WALL",
  "kind": "custom", "source": "map-theme",
  "imageUrl": "data:image/png;base64,…",   // 구워진 시트가 통째로 들어간다
  "tileIdBase": 2049,                       // 타일 id = 2049 + 슬롯 인덱스
  "tileWidth": 32, "tileHeight": 32,
  "tileProperties": { "2049": { "name": "floor 01", "category": "floor",
                                "movement": "passable", "blocksMovement": false } }
}
```

★ `tiles[]` 가 비어 있으면 `_stripBakedTilesetSheet` 가 `imageUrl` 을 **지우지 않는다**.
그래서 시트를 data URL 로 박아 넣으면 그대로 유지된다 — Studio UI 를 거치지 않고
임의의 타일셋을 맵에 붙일 수 있다는 뜻이다.

### 기본 제공 테마 (`pnpm fetch-theme`)

새 계정에는 `studio/data/server-studio-seed.json` 이 심어진다. **로그인 없이 받아진다.**
그 안의 기본맵에 붙은 테마가 "기본 맵 데이터" — 타일 20장, 32px, id 2049~2068.

| id | 그림 | 분류 |
|---:|---|---|
| 2049 · 2059 · 2068 | 흙바닥 / 흙+풀덤불 | floor |
| 2050 · 2062 | 물 | slowed |
| 2051 · 2052 | 돌담 | **blocked** |
| 2053 · 2057 · 2060 · 2063 | 민 잔디 | decoration |
| 2054 · 2058 · 2061 · 2065 · 2066 · 2067 | 꽃 핀 잔디 | decoration |
| 2055 · 2056 | 나무 | **blocked** |
| 2064 | 회색 포장 돌바닥 | (분류기가 blocked 로 잘못 붙임 → 교정) |

**전부 야외 자연 타일이다.** 목재 바닥·침대·소파·책장·욕조·주방 같은 실내 요소는 하나도 없다.
실내 평면도를 만들려면 Object 에디터에서 실내 테마를 따로 만들어야 한다.

분류기 이름이 그림과 어긋난 것이 있다 — `wall 58`/`wall 59` 는 실제로 나무이고,
`wall 90` 은 돌바닥이다. 그래서 이 리포는 분류기 이름 대신 **별칭**(`grass` · `dirt` ·
`stone_wall` · `tree` · `water` · `stone_floor` · `flowers` · `bush`)을 쓰고,
`wall 90` 의 잘못된 blocked 분류는 `fetch-theme` 이 교정한다.

### 타일 id

| 항목 | 값 |
|---|---|
| 내장 타일셋 | `builtin_tp_tile01` = `/assets/TP_Tile01.png` 512×512 |
| 구성 | 32px × **16열 × 16행 = 256장** |
| id 계산 | `id = 행 × 16 + 열 + 1` (`tileIdBase` 1), **0 = 빈 칸** |
| 두 번째 타일셋 | `tileIdBase` 가 `1 + 2048` 부터 (`TILESET_ID_STRIDE`) |
| 룰 브러시 | `50000` 이상 (`RULE_BRUSH_TILE_ID_BASE`) |

`pnpm tiles` → `out/tile-picker.html` 에서 256장을 id 와 함께 보고 고른다.

내장 타일셋은 마을·야외 세트다. 실측으로 고른 쓸 만한 id:

| id | 그림 |
|---:|---|
| 5 | 짙은 잔디 (가장 단색에 가까움) |
| 7 | 베이지 벽돌 바닥 |
| 23 | 초록 벽돌 바닥 |
| 25 · 41 | 물 |
| 35 · 36 | 흙 |
| 47 | 건물 벽 + 창 |
| 45 | 건물 벽 + 아치문 |
| 69 | 나무 바닥 |
| 113 | 격자 돌바닥 |
| 39 고목 · 42 나무통 · 52 우물 | 소품 |

### 오브젝트 (구역)

맵 안의 "이 사각형이 무엇인지" 를 적는 유일한 자리다 (`ObjectRegistry`).

```jsonc
{ "id": "obj_archive", "name": "서고", "tags": ["room"], "description": "",
  "rect": { "col": 1, "row": 1, "width": 16, "height": 11 }, "color": "#6b4f2a" }
```

---

## 4. 이 리포의 생성기

```
src/spum-map.mjs      맵 레코드 정규화·검증 (MapStore._normalize 와 같은 규칙)
src/spum-theme.mjs    맵 테마 읽기 — 타일 별칭·분류·이동 특성, 타일셋 자산 변환
src/png.mjs           최소 PNG 인코더 + 그리기 캔버스 (의존성 없음)
src/tile-art.mjs      실내 타일을 코드로 그린다 (프로토타입 그림)
src/map-builder.mjs   레이아웃 설정 → 맵 레코드 (방·복도·문·소품 → 타일)
src/map-preview.mjs   맵 레코드 → 미리보기 HTML (실제 타일로 그린다)
src/studio-backup.mjs Studio 백업 파일 읽기·병합
scripts/make-map.mjs  CLI
scripts/fetch-theme.mjs SPUM 기본 맵 테마 수집 → out/themes/spum-default.json
scripts/make-tileset.mjs 실내 타일셋을 코드로 생성 → out/themes/proto-interior.json
scripts/tile-picker.mjs 타일 표 (테마가 있으면 테마를, 없으면 내장 타일셋을)
scripts/test-map.mjs  자체 검사 (pnpm test 에 포함)
bake/example-map.json 예시 — 서고 게임의 방 6개
```

### 쓰는 법

```bash
pnpm fetch-theme                              # SPUM 기본 맵 테마 받기 → out/themes/
pnpm tiles                                    # 타일 표 → out/tile-picker.html
cp bake/example-map.json bake/my-map.json     # 방·복도·문을 사각형으로 적는다
pnpm map --config bake/my-map.json --preview --html
```

`--preview` 는 터미널 ASCII, `--html` 은 실제 타일로 그린 `out/<slug>-preview.html` 이다.
넣기 전에 여기서 본다.

```bash
# Studio 우상단 메뉴 → 데이터 저장 으로 백업을 받은 뒤
pnpm map --config bake/my-map.json --into ~/Downloads/spum-studio-backup-20260819.json
```

→ `out/<slug>-studio-map.json` 이 나온다. Studio 에서 **데이터 불러오기** → 새로고침 → 서버 저장.

같은 이름의 맵이 백업에 있으면 **id 를 유지한 채** 덮어쓴다. 월드가 그 맵을 참조하고 있어도
링크가 안 끊긴다. 새 맵으로 추가하려면 `--append`.

### 레이아웃 설정

```jsonc
{
  "slug": "seogo-night",
  "name": "서고의 밤 — 저택 부지",
  "width": 40, "height": 30, "tileSize": 32,

  // 타일은 테마 별칭·이름·슬롯(#3)·원시 id 중 아무거나. 배열이면 좌표 해시로 섞는다
  // (같은 타일을 넓게 깔면 가장자리 처리 때문에 격자가 보인다). 같은 값을 여러 번
  // 넣으면 그만큼 자주 나온다 — 비율 조절.
  "tiles": {
    "ground": ["grass", "grass:1", "grass:2", "flowers"],
    "floor": "dirt",
    "wall": "stone_wall"
  },
  "groundWalkable": false,                           // 맵 바깥 지면을 걸을 수 있게 할지

  "rooms": [{
    "id": "archive", "name": "서고", "description": "…",
    "rect": [1, 1, 16, 11],          // [col, row, width, height] — 객체 형태도 됨
    "floor": 113, "wall": 47,        // 생략 시 tiles 기본값
    "walls": false,                  // 야외 구역: 테두리 벽 없이 전부 바닥
    "tags": ["room"], "color": "#6b4f2a",
    "doors": [{ "side": "south", "at": 8, "width": 2 }],  // at = 절대 타일 좌표, 생략 시 중앙
    "spawn": { "x": 9, "y": 6, "label": "서고" }          // 생략 시 방 중앙, false 면 안 만듦
  }],

  "corridors": [{ "name": "서고 앞", "rect": [8, 11, 2, 3], "floor": 7 }],
  "props": [{ "tile": 39, "at": [[12, 14], [18, 17]], "blocking": true }]
}
```

그리는 순서가 곧 우선순위다: **지면 → 방 바닥/벽 → 복도 → 문 → 소품.**
복도가 방 벽을 지나가면 그 칸은 자동으로 뚫린다.

### 검증

Studio 는 잘못된 맵을 조용히 삼킨다. 그래서 파일을 쓰기 전에 잡는다:

- 필수 레이어 · `data` 길이 · 내비 레이어 0/1
- 내장 타일셋 범위(1~256) 밖 타일 id
- `walkable` 이 한 칸도 없음
- 스폰이 맵 밖이거나 `walkable` 이 아닌 칸
- **연결성** — 첫 스폰에서 walkable 을 flood fill 해서, 못 가는 스폰이 있으면 오류.
  문이나 복도를 빠뜨린 방을 여기서 잡는다 (Studio 는 안 잡아준다)
- **테마 이동 특성 충돌** — `movement: blocked` 인 타일을 바닥(walkable)으로 깔면 경고.
  Studio 에서 덧칠하면 `applyTilePropertiesToNavigation` 이 obstacle 로 뒤집는다

---

## 5. Studio 를 거치지 않고 타일셋 만들기

Object 에디터의 슬라이스·분류를 안 거쳐도 타일셋을 만들 수 있다. 근거는 3절의
`_stripBakedTilesetSheet` 규칙 — `tiles[]` 가 비면 `imageUrl` 이 유지된다.
필요한 건 시트 PNG 와 `tileProperties` 뿐이다.

```bash
pnpm tileset                                        # 코드로 그린 실내 타일 15장
pnpm map --config bake/proto-interior.json \
         --theme out/themes/proto-interior.json --html
```

`src/png.mjs` 가 PNG 인코더(zlib + CRC32, 의존성 없음)와 그리기 캔버스를,
`src/tile-art.mjs` 가 타일 그림을 담당한다. 그림은 프로토타입이다 —
반복 텍스처(목재 바닥·회벽·타일)는 쓸 만하고 가구는 조잡하다.
**진짜 타일이 생기면 `tile-art.mjs` 만 갈아끼우면 되고, 레이아웃·검증·백업 생성은 그대로다.**

`bake/proto-interior.json` 이 방 8개짜리 실내 평면도 예시다. 인접한 방의 사각형을
**한 줄 겹치게** 두면 벽을 공유한다 (테두리 겹침은 정상이라 경고하지 않는다 —
방 내부가 겹칠 때만 잡는다).

## 6. 남은 미확인 항목

1. **불러오기 왕복을 실제로 못 해봤다.** 스키마·키는 소스에서 확정했지만, 생성한 파일을
   Studio 에 넣어 화면에 뜨는 것까지는 로그인 세션이 필요하다. 첫 import 때 확인할 것:
   맵 목록에 뜨는지 · 타일이 의도한 그림인지 · walkable 이 살아 있는지.
2. Playwright 로 세션을 잡아 `PUT /api/studio/state` 를 직접 치는 자동화는 가능해 보이나
   `baseRevision`/해시 충돌 프로토콜을 따라야 한다 — 미검증.
3. `/api/ai-tiles/*` 는 AI 타일 생성으로 보이나 경로 전개를 확인 못 했다.
4. `tilesets` 에 커스텀 타일셋(테마)을 넣는 경로 — `MapThemeLibrary` 가 IndexedDB
   (`spum-map-theme-source-library`) 를 쓴다. 내장 타일셋만으로 부족하면 그쪽을 파야 한다.
