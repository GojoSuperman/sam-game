# sam-game

SPUM 월드 위에 SAM API 로 게임을 만들기 위한 셋업.

- 조사 결과와 구조 전체: **[docs/SPUM SAM 연동 구조.md](docs/SPUM%20SAM%20연동%20구조.md)**
- 맵 스키마와 생성기: **[docs/SPUM 맵 스키마와 생성.md](docs/SPUM%20맵%20스키마와%20생성.md)**
- 무엇을 Studio 에서 / 무엇을 코드에서: **[docs/Studio와 Claude Code 역할 분담.md](docs/Studio%EC%99%80%20Claude%20Code%20%EC%97%AD%ED%95%A0%20%EB%B6%84%EB%8B%B4.md)**
- 이미지로 맵 만들기 (스킬 계획): **[docs/이미지로 맵 만들기 — 스킬 계획서.md](docs/%EC%9D%B4%EB%AF%B8%EC%A7%80%EB%A1%9C%20%EB%A7%B5%20%EB%A7%8C%EB%93%A4%EA%B8%B0%20%E2%80%94%20%EC%8A%A4%ED%82%AC%20%EA%B3%84%ED%9A%8D%EC%84%9C.md)**
- SAM API 스펙 전체: **[docs/SAM API 레퍼런스.md](docs/SAM%20API%20레퍼런스.md)**
- 요구 환경: Node 22+ (현재 v24.16.0 확인), 의존성 없음 — 전부 표준 라이브러리

## 현재 상태 (2026-08-20 실측)

### 되는 것

- **Studio 를 코드가 직접 몬다.** Playwright 로 크롬을 띄워 로그인 세션을 쓴다.
  맵 주입·에셋 회수·**AI 이미지 생성**까지 전부 코드에서 된다 (8~10절).
- **AI 조감도 → 맵** 파이프라인이 두 주제에서 재현됐다 (우주선 실내, 중세 여관).
  `/spum-map` 스킬 한 번이면 창이 뜨고 끝까지 이어진다.
- 만들어진 씬 맵 6개: `작은 정원` · `판타지 시장 광장` · `다다미 집` · `성주의 거처` ·
  `중세 여관 1층` · `우주선 조감도` (전부 32×32, 계정 서버에 보존).

> 8-18 에 적어둔 *"SPUM 은 free 티어, `canUseAI: false`"* 는 더 이상 맞지 않는다.
> 8-20 실측에서 `/api/ai-tiles/generate` 가 정상 동작했고(계정 `builder`, `samAvailable: true`),
> 이미지 생성·슬라이스가 모두 성공했다.

### 막혀 있던 것 (8-18 기준, 이후 재확인 안 함)

- **SAM 생성 호출** — `POST /v1/generate` 가 약 30.7초 뒤 503
  `Account initialization is temporarily unavailable`. 키·모델·표면을 모두 바꿔도 동일했고
  `GET /v1/models` 는 항상 200 이었다. **SoonSoon 서버측 문제**로 보였다.
  8-20 세션에서는 다시 확인하지 않았다 — `pnpm doctor` 로 현재 상태를 본다.

### 알아둘 제약

| | |
|---|---|
| 세션 | 서버가 로그인 후 약 30분에 세션을 끊는다 (15분에 쿠키 회전 1회 → 30분 종료, 2026-08-21 계측). 작업은 로그인 직후 몰아서 한다 |
| 저장소 | localStorage 한도 **약 5MB**. 씬 맵 하나가 ~500KB |
| 비용 | AI 이미지 생성 회당 **약 125쌤** (씬 맵은 조감도+마스크로 250쌤) |
| ★ 동시 실행 | **Studio 창을 열어둔 채 스크립트를 돌리지 않는다** — 저장이 어디에도 안 남는다 |

## 다른 프로젝트에서 이 킷 쓰기

맵 파이프라인은 이제 **별도 공개 저장소 [spum-kit](https://github.com/GojoSuperman/spum-kit)** 에서 관리한다. 새 폴더에서:

```bash
git clone --depth 1 https://github.com/GojoSuperman/spum-kit.git /tmp/spum-kit \
  && bash /tmp/spum-kit/install.sh
```

스킬(`.claude/skills/spum-map/`) · 파이프라인 9개 파일 · npm scripts · `.gitignore` 가 놓이고
의존성까지 깔린다. 그 폴더에서 `claude` 를 띄우고 **"맵 만들어줘"** 라고 하면 된다.

### 키는 어떻게 넣나

**맵 만들기에는 API 키가 필요 없다.** 인증은 브라우저 SSO 세션이고, 킷의 9개 파일이 읽는
환경변수는 `SPUM_STUDIO_HOME` 하나뿐이다 (프로필 위치를 옮기고 싶을 때만).

```bash
npm run studio-login      # 창이 뜨면 이메일 매직링크를 누른다 — 계정당 한 번
```

로그인 프로필은 **홈 공용 `~/.spum-studio/`** 에 저장된다. 그래서 프로젝트를 새로 파도
다시 로그인하지 않는다. 생성 비용(쌤)은 그 계정에서 빠진다.

> **주의**: 계정당 세션은 하나다. 평소 브라우저로 Studio 에 로그인하면 자동화 세션이 죽는다.
> 두 곳을 오갈 때의 절차는 [docs/Studio 를 두 곳에서 쓰기.md](docs/Studio%20%EB%A5%BC%20%EB%91%90%20%EA%B3%B3%EC%97%90%EC%84%9C%20%EC%93%B0%EA%B8%B0.md) 에 있다.

**SAM API 키가 필요한 것은 게임 프록시 쪽**(`npm run game`, `server/sam-proxy.mjs`)이다.
[sam.soonsoon.ai/api-keys](https://sam.soonsoon.ai/api-keys) 에서 발급해 로컬에만 둔다:

```bash
cp .env.example .env.local     # SAM_API_KEY= 에 값을 넣는다
```

`.env` · `.env.local` 은 `.gitignore` 에 있고 **저장소에 키가 들어간 적은 없다**
(공개 전환 시 히스토리 전수 검사 완료). 발급 시 월 쌤 한도를 지정하면 이 프로젝트 비용만
따로 볼 수 있다. 실수로 키를 커밋했다면 세탁보다 **폐기 후 재발급**이 먼저다.

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

## 브라우저 자동화 셋업 (맵 만들기에 필요)

SPUM Studio 는 **httpOnly 쿠키 세션**으로만 인증한다 — API 키로 들어가는 길이 없다.
그래서 서버를 건드리는 일(AI 이미지 생성·에셋·저장)은 전부 브라우저를 통해야 한다.
Playwright 로 크롬을 띄워 코드가 직접 몬다.

### 1) 설치 — PC 당 1회

```bash
npm i                                # playwright 포함
npx playwright install chromium      # 크롬 바이너리 (~150MB)
```

이어서 **시스템 라이브러리 33개**가 필요하다 (`libnspr4`, `libnss3`, `libatk*`, X11·폰트 계열).
없으면 크롬이 `error while loading shared libraries` 로 뜨지 않는다.

```bash
sudo npx playwright install-deps chromium
```

`sudo` 비밀번호를 모르거나 막혀 있으면 **WSL 안에서 root 로 바로** 실행할 수 있다
(비밀번호를 묻지 않는다):

```bash
/mnt/c/Windows/System32/wsl.exe -d Ubuntu -u root \
  $(which node) $(pwd)/node_modules/playwright/cli.js install-deps chromium
```

> WSL2 라면 **WSLg** 가 있어야 창이 화면에 뜬다. `echo $DISPLAY` 가 `:0` 이면 준비된 것이다.
> 없어도 headless 로는 돌지만, 작업 과정을 지켜볼 수는 없다.

### 2) 로그인 — PC 당 1회

```bash
npm run studio-login
```

창이 뜨면 **사람이 직접 로그인한다.** SSO 가 이메일 매직링크라 자동화할 수 없다.
로그인 후 세션은 **`~/.spum-studio/`** 에 저장되고, 이후 스크립트가 알아서 갱신한다.

프로필이 홈에 있어서 **SPUM 프로젝트를 새로 만들어도 다시 로그인하지 않는다.**
localStorage 도 한 벌이라 프로젝트 사이에서 상태가 어긋나지 않는다.
위치를 바꾸려면 `SPUM_STUDIO_HOME` 환경변수를 쓴다.

> **계정당 세션은 하나다.** 평소 브라우저로 Studio 에 로그인하면 자동화 세션이 죽어
> (`/api/me` 가 `{"user":null}`) 매직링크 재로그인이 필요하다. 두 곳을 오갈 때의 절차는
> [docs/Studio 를 두 곳에서 쓰기.md](docs/Studio%20%EB%A5%BC%20%EB%91%90%20%EA%B3%B3%EC%97%90%EC%84%9C%20%EC%93%B0%EA%B8%B0.md) 참고.

### 3) ★ 창을 열어둔 채 작업하지 않는다

`npm run studio-open` 으로 띄운 창을 **열어둔 채** 다른 스크립트를 돌리면,
같은 프로필을 두 크롬이 잡아 *"기존 브라우저 세션에서 여는 중입니다"* 가 되고
**그 세션이 쓴 내용은 어디에도 남지 않는다.** localStorage 소실 · 저장 실패 ·
쿠키 미보존이 전부 여기서 나온다.

지금은 스크립트가 시작 전에 검사해서 pid 와 함께 중단시키지만, 습관을 들이는 편이 낫다:
**보고 나면 창을 닫는다.** (`Ctrl+C` 말고 창을 닫아야 세션이 정상 저장된다.)

### 4) 다른 곳에서 Studio 를 만졌다면 — `npm run studio-pull`

Studio 동기화는 **append-only** 다. 부팅할 때 로컬과 서버가 다르면 서버를 읽어오는 게 아니라
**로컬을 새 리비전으로 얹는다.** 그래서 낡은 로컬로 열면 낡은 상태가 최신이 된다.

```bash
npm run studio-pull -- --list      # 서버 리비전 목록 (▶ 가 활성)
npm run studio-pull                # 활성 리비전을 로컬에 반영하고 시작
```

잃어버린 것 같아도 히스토리에 남아 있다 — `--revision <번호>` 로 되돌린다.

---

## 맵 만들기 — `/spum-map` 스킬

Claude Code 에서 **"이런 느낌으로 맵 만들어줘"** 라고 하면 발동한다.
`.claude/skills/spum-map/` 에 들어 있어 이 저장소를 받은 사람은 그대로 쓸 수 있다
(스킬은 세션 시작 시 로드되므로, 처음 받았다면 Claude Code 를 한 번 재시작한다).

### 무엇을 하나

AI 가 그린 **조감도 한 장**을 32×32 격자로 잘라 1024칸을 각각 고유 타일로 등록한다.
타일을 반복해 까는 방식과 달리 완성된 일러스트가 그대로 맵이 된다.

```
① 씬 조감도 생성 (AI)          ④ 통행 판정 · 고립 구역 잇기
② 참조본 512² 축소             ⑤ Studio 주입
③ 통행 마스크 생성 (img2img)   ⑥ 새로고침 · 확인 스크린샷
```

**창 하나가 뜬 채로 여섯 단계가 이어져서, 작업 과정을 눈으로 지켜볼 수 있다.**

### 진행 방식

스킬은 **먼저 묻는다.** 회당 약 250쌤이 들기 때문에, 그림이 나온 뒤에
방향이 틀렸다는 걸 알면 비용이 그대로 날아간다.

| 묻는 것 | 예 |
|---|---|
| **구역 구성** | "바 카운터 우상 · 벽난로 좌측 · 계단 우하 · 술통 좌하" (3~6개) |
| **양식 · 시대** | 중세 / 현대 / SF / 판타지 |
| **분위기 · 조명** | 밤의 촛불 / 밝은 낮 — **밝을수록 마스크가 정확하다** |
| **녹화 여부** | 남기면 `out/videos/*.webm` 으로 전 과정이 저장된다 |

답을 받으면 **프롬프트 초안을 보여주고** 실행한다.

### 직접 실행하려면

```bash
npm run scene-map -- --name "작은 정원" \
  --prompt-file prompts/garden.txt --headed --quality medium
```

| 옵션 | |
|---|---|
| `--headed` | 창을 띄운다 (지켜보려면 필수) |
| `--quality low\|medium\|high` | 생성 품질. 기본 high 지만 **medium 을 권한다** — 아래 참고 |
| `--model <모델>` | `gpt-image-2`(기본) · `gpt-image` · `FLUX.2-pro` |
| `--keep-open` | 끝나도 창을 닫지 않고 사람이 닫을 때까지 기다린다 |
| `--record` | 전 과정을 webm 으로 녹화 (창이 닫혀야 파일이 떨어진다) |
| `--dry-run` | 그림만 만들고 주입하지 않는다 |
| `--jpeg <품질>` | 시트 압축률 (기본 68). 저장소가 빠듯하면 낮춘다 |

**`--quality medium` 을 권하는 이유** (실측): high 는 생성이 60~70초로 길어져 앞단 nginx
타임아웃(`504`)에 걸린다 — 같은 프롬프트가 high 로 **두 번 연속 504**(249쌤 증발) 났고,
medium 으로 낮추자 **28~39초에 통과**했다 (이후 5회 연속 성공). 자세한 근거는 문서 10-3 절.

검증된 프롬프트는 `.claude/skills/spum-map/references/프롬프트 예시.md` 에 있다.

### 알아둘 제약

| | |
|---|---|
| 비용 | 회당 **약 250쌤** (조감도 + 마스크) |
| 프롬프트 | **520자 이하.** 507자에서 `504`, 446자에서 성공 (실측) |
| 저장소 | localStorage 한도 **약 5MB**, 씬 맵 하나가 ~500KB |
| 마스크 | **눈으로 확인한다.** `out/scene-walkmask.png` 에서 초록=통행 |
| 사람 | 프롬프트에 넣지 않는다. 캐스트는 Studio 에서 따로 배치 |
| 야외 맵 | 물·잔디 판정을 특히 확인한다. 마스크 프롬프트에 물은 막고 잔디는 걷게 명시해 뒀지만, 매번 결과를 본다 |

---

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

### 브라우저 자동화 (Studio 를 코드로 몰기)

| 명령 | 하는 일 |
|---|---|
| `npm run studio-login` | **창을 띄워 사람이 로그인** (PC 당 1회, 세션은 이후 자동 갱신) |
| `npm run scene-map -- --name "<이름>" --prompt-file <파일> --headed --quality medium` | **AI 조감도 → 맵 한 방** (아래 참조) |
| `npm run studio-pull [-- --list\|--revision <n>]` | **서버 리비전 → 로컬.** 다른 곳에서 Studio 를 만졌다면 작업 전에 |
| `npm run studio-open [-- --section map]` | Studio 창을 띄워 눈으로 확인 (**다 보면 창을 닫을 것**) |
| `npm run studio-apply -- --map <맵.json> [--dry-run]` | 맵 레코드를 Studio 에 주입 |
| `npm run studio-assets -- --theme "<테마>"` | 테마의 원본·타일 이미지 내려받기 |
| `npm run studio-restore [-- --from <백업>]` | 서버(또는 백업 파일) → 로컬 복원 |
| `npm run studio-probe` / `studio-sections` | 백업 + 전역·DOM·API 정찰 (읽기 전용) |
| `npm run studio-ai-theme -- …` | AI 타일/씬 생성 단일 단계 (`--generate` 없으면 설정만) |
| `node scripts/scene-to-map.mjs …` | 조감도+마스크 → 맵 레코드 (오프라인) |

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
