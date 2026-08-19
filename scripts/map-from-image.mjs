#!/usr/bin/env node
/**
 * 이미지 한 장 → SPUM 맵 (타일셋 + 레이어 + 통행 판정).
 *
 * 톱다운 맵 이미지를 그대로 맵으로 만든다. 격자를 자동 추정하고, 픽셀이 같은 칸을
 * 합쳐 고유 타일을 뽑고, 각 타일의 역할(바닥·물·차단·장식)을 이미지 특징으로 추정한다.
 *
 * 판정은 틀릴 수 있다 — 돌담과 돌바닥은 색이 거의 같다. 그래서 **교정용 HTML** 을
 * 같이 낸다. 칸이 수천 개라도 고유 타일은 수십 장이라 그것만 보면 된다.
 * 교정 결과는 `--roles <파일>` 로 다시 넣는다.
 *
 * 사용:
 *   node scripts/map-from-image.mjs --image <이미지> [--cell 64] [--target 32]
 *   node scripts/map-from-image.mjs --image <이미지> --roles out/<key>-roles.json --snippet
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { Canvas, toDataUrl } from '../src/png.mjs';
import { loadImage, encodeJpeg } from '../src/image-io.mjs';
import { sliceImage, detectCellSize, guessRole, classifyPlanCell } from '../src/image-tiles.mjs';
import { readColorMask, MASK_LEGEND } from '../src/blueprint.mjs';
import { ROLES, roleCss, binaryCss, legendHtml, LEGEND_CSS } from '../src/roles.mjs';
import { autoConnect } from '../src/auto-connect.mjs';
import { cropImage, trimWhite } from '../src/image-io.mjs';
import { normalizeMapRecord, LAYER_TYPES, NAV_ON, NAV_OFF, createGrid, idx, validateMapRecord, reachableFrom } from '../src/spum-map.mjs';
import { buildMapSnippet } from '../src/studio-snippet.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const imagePath = arg('image');
if (!imagePath) {
  console.error(`사용법: node scripts/map-from-image.mjs --image <이미지.png> [옵션]

  --cell <px>       격자 칸 크기. 생략하면 자동 추정
  --target <px>     결과 타일 크기 (기본 32). 정수배 확대/축소만
  --jpeg [품질]     시트를 JPEG 로 담는다 (기본 85). 도면처럼 타일이 많을 때 1/10 로 줄어든다
  --pair v|h        한 이미지에 [그림 | 색 마스크] 두 판이 들어 있을 때. v=위아래, h=좌우
                    흰 여백으로 판 경계를 자동으로 찾는다 (정확히 반이 아니어도 된다)
                    그림은 타일로, 마스크는 통행 판정으로 쓴다. 정렬 일치도를 검사한다
  --split a,b,c,d   판 경계를 직접 준다 (그림 시작,끝 / 마스크 시작,끝)
  --no-trim         판의 흰 여백을 자르지 않는다 (기본은 자르고 도면 범위로 맞춤)
  --plan            손그림 평면도 판정 — 벽·바닥·가구·식재·물 5종을 픽셀 투표로 가른다
  --floor-bright <v> 이 명도(0~1) 이상이면 바닥 (단순 규칙. --plan 이 더 낫다)
  --cells <파일>    격자 칠하기로 고친 통행 판정을 다시 넣는다
  --connect         끊긴 방을 자동으로 잇는다. 그림이 밝은 곳(=실제 문)을 골라 뚫고
                    뚫은 좌표를 전부 보고한다. 기본 꺼짐
  --connect-max <n> 한 곳을 잇는 데 뚫어도 되는 최대 칸수 (기본 5)
  --roles <파일>    역할 교정 파일 (교정 HTML 에서 복사한 것)
  --exact           픽셀 완전 일치로만 합친다 (SPUM 과 같은 기준. 보통 안 합쳐진다)
  --blocks <n>      근사 dedup 격자 (기본 4). 올리면 더 엄격
  --levels <n>      근사 dedup 색 단계 (기본 6). 올리면 더 엄격
  --name <이름>     맵 이름
  --snippet         주입 스니펫도 만든다
  --html            미리보기 HTML 도 만든다
  --scale <배율>    미리보기 배율`);
  process.exit(1);
}

let img = await loadImage(resolve(imagePath));   // PNG · JPEG 둘 다

// ── 짝 이미지 — [그림 | 색 마스크] 를 한 캔버스에 받은 경우 ────────────
//
// 왜 이렇게 받나: 그림에서 벽·가구를 색으로 가르는 건 화풍에 따라 실패한다
// (세피아 도면은 초록 픽셀이 0.1%뿐이었다). 반대로 색 코드 마스크는 판독이
// 확실하다(자체 검증 저신뢰 0칸). 둘을 **한 번의 생성으로 같은 캔버스에** 받으면
// 배치가 어긋날 위험이 크게 줄고, 그림은 그림대로 쓰고 판정은 마스크에서 읽는다.
const pairMode = arg('pair');
let maskImage = null;
if (pairMode) {
  const horizontal = pairMode.startsWith('h');
  const limit = horizontal ? img.width : img.height;
  const across = horizontal ? img.height : img.width;

  // 판 경계를 흰 여백에서 찾는다. AI 는 정확히 반으로 안 나눠 그린다 —
  // 실측: 896×1200 이미지에서 판 사이 여백이 587~614 행이었고 위아래 판 크기가 달랐다.
  let bands;
  const splitArg = arg('split');
  if (splitArg) {
    const [a, b, c, d] = splitArg.split(',').map(Number);
    bands = [[a, b], [c, d]];
  } else {
    const white = [];
    for (let i = 0; i < limit; i += 1) {
      let n = 0;
      for (let j = 0; j < across; j += 1) {
        const px = horizontal ? (j * img.width + i) : (i * img.width + j);
        const k = px * 4;
        if (img.data[k] > 230 && img.data[k + 1] > 230 && img.data[k + 2] > 230) n += 1;
      }
      white.push(n / across > 0.97);
    }
    const runs = [];
    let start = -1;
    for (let i = 0; i < limit; i += 1) {
      if (!white[i]) { if (start < 0) start = i; }
      else if (start >= 0) { if (i - start >= limit * 0.15) runs.push([start, i - 1]); start = -1; }
    }
    if (start >= 0 && limit - start >= limit * 0.15) runs.push([start, limit - 1]);
    if (runs.length < 2) {
      // 흰 여백이 없는 경우 — 마스크 판 배경이 검정이면 여백으로 안 갈린다.
      // 그때는 **순수 채도색 밀도**로 찾는다. 색 코드 마스크는 마젠타·초록·청록·노랑이
      // 대량으로 들어가고, 그림 판에는 그런 색이 거의 없다.
      // 실측: 그림 판 순수색 0~1% vs 마스크 판 13~22%.
      const pure = [];
      for (let i = 0; i < limit; i += 1) {
        let n = 0;
        for (let j = 0; j < across; j += 1) {
          const px = horizontal ? (j * img.width + i) : (i * img.width + j);
          const k = px * 4;
          const r = img.data[k]; const g = img.data[k + 1]; const b = img.data[k + 2];
          const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
          if (mx > 200 && mx - mn > 150) n += 1;
        }
        pure.push(n / across);
      }
      // 앞쪽 절반과 뒤쪽 절반의 밀도를 비교해 경계를 훑는다
      let bestCut = -1; let bestGap = 0;
      for (let cut = Math.floor(limit * 0.25); cut < Math.floor(limit * 0.75); cut += 1) {
        let a = 0; let b = 0;
        for (let i = 0; i < cut; i += 1) a += pure[i];
        for (let i = cut; i < limit; i += 1) b += pure[i];
        const gap = Math.abs(b / (limit - cut) - a / cut);
        if (gap > bestGap) { bestGap = gap; bestCut = cut; }
      }
      if (bestCut < 0 || bestGap < 0.03) {
        console.error(`  ✖ 판 두 개를 못 찾았습니다 (여백 덩어리 ${runs.length}개, 색 밀도 차 ${(bestGap * 100).toFixed(1)}%).`);
        console.error('    --split 으로 경계를 직접 주세요 (예: --split 0,592,600,1199).');
        process.exit(1);
      }
      // 경계 부근의 얇은 틈을 피해 몇 픽셀 물러난다
      bands = [[0, Math.max(0, bestCut - 6)], [Math.min(limit - 1, bestCut + 6), limit - 1]];
      console.log(`  판 경계를 색 밀도로 찾았습니다 (cut ${bestCut}, 밀도 차 ${(bestGap * 100).toFixed(1)}%)`);
    } else {
      bands = runs.slice(0, 2);
    }
  }

  const cut = ([a, b]) => (horizontal
    ? cropImage(img, a, 0, b - a + 1, img.height)
    : cropImage(img, 0, a, img.width, b - a + 1));
  const rawFirst = cut(bands[0]);
  const rawSecond = cut(bands[1]);
  console.log(`  짝 이미지 ${horizontal ? '좌우' : '위아래'} 분할 (경계 ${bands.map((b) => b.join('~')).join(' / ')})`);
  console.log(`    판 크기  그림 ${rawFirst.width}×${rawFirst.height} · 마스크 ${rawSecond.width}×${rawSecond.height}`);

  // 여백을 잘라 도면의 실제 범위로 맞춘다 — 판 크기가 달라도 정렬된다
  if (!flag('no-trim')) {
    const a = trimWhite(rawFirst);
    const b = trimWhite(rawSecond);
    img = a.img;
    maskImage = b.img;
    console.log(`    여백 제거  그림 ${img.width}×${img.height} · 마스크 ${maskImage.width}×${maskImage.height}`);
  } else {
    img = rawFirst;
    maskImage = rawSecond;
  }
  const ratioGap = Math.abs(img.width / img.height - maskImage.width / maskImage.height);
  console.log(`    종횡비 차 ${(ratioGap * 100).toFixed(1)}%` + (ratioGap > 0.06 ? ' ⚠ 두 판을 다른 비율로 그렸습니다' : ' ✓'));
}
const dedup = {
  exact: flag('exact'),
  blocks: Number(arg('blocks', '4')) || 4,
  levels: Number(arg('levels', '6')) || 6,
};
const key = (arg('key') || basename(imagePath).replace(/\.[^.]+$/, '')).replace(/[^\w가-힣-]+/g, '-');
console.log(`[map-from-image] ${imagePath} · ${img.width}×${img.height}`);

// ── 1. 격자 ────────────────────────────────────────────────
let cell = Number(arg('cell', '0')) || 0;
if (!cell) {
  const { best, report } = detectCellSize(img, undefined, dedup);
  if (!best) { console.error('격자를 추정하지 못했습니다. --cell 로 직접 주세요.'); process.exit(1); }
  console.log('  격자 추정 (반복률 높은 순):');
  for (const r of report.slice(0, 4)) {
    console.log(`    ${String(r.cell).padStart(3)}px → ${r.cols}×${r.rows} · 고유 ${r.unique}/${r.total} · 반복률 ${Math.round(r.repeat * 100)}%`);
  }
  cell = best.cell;
  console.log(`  → ${cell}px 선택`);
}

const target = Number(arg('target', '32')) || 32;
const scaleUp = target / cell;
if (!Number.isInteger(scaleUp) && !Number.isInteger(1 / scaleUp)) {
  console.error(`--target(${target}) 은 --cell(${cell}) 의 정수배나 정수분의 1 이어야 합니다.`);
  process.exit(1);
}

// ── 2. 슬라이스 + 판정 ────────────────────────────────────
const sliced = sliceImage(img, cell, dedup);
// 짝 마스크가 있으면 판정을 거기서 읽는다 (셀 단위 오버라이드로 들어간다)
let pairRoles = null;
if (maskImage) {
  const m = readColorMask(maskImage, sliced.cols, sliced.rows);
  pairRoles = m.roles;
  const t = {};
  for (const r of m.roles) t[r] = (t[r] || 0) + 1;
  console.log(`  마스크 판독: ${Object.entries(t).map(([k, v]) => `${k} ${v}`).join(' · ')}` + (m.lowConfidence ? ` · 저신뢰 ${m.lowConfidence}칸` : ' · 저신뢰 0칸'));

  // 정렬 검사 — 마스크의 벽이 그림의 어두운 칸과 겹치는지. 어긋나면 여기서 잡는다.
  let wallCells = 0; let agree = 0;
  for (let i = 0; i < pairRoles.length; i += 1) {
    if (pairRoles[i] !== 'wall') continue;
    wallCells += 1;
    const tile = sliced.tiles[sliced.grid[i]];
    if (tile?.stats && (tile.stats.hsv.v < 0.62 || tile.stats.darkRatio > 0.2)) agree += 1;
  }
  const rate = wallCells ? Math.round((agree / wallCells) * 100) : 0;
  console.log(`  정렬 일치도: 마스크 벽 ${wallCells}칸 중 ${agree}칸이 그림에서도 어둡다 (${rate}%)`);
  if (rate < 55) {
    console.log('  ⚠ 일치도가 낮습니다 — AI 가 두 판의 배치를 다르게 그렸을 수 있습니다.');
    console.log('    칠하기 화면에서 확인하고, 심하면 다시 생성하세요.');
  }
}

// 손그림 평면도 판정 — 5종을 픽셀 투표로
if (flag('plan')) {
  for (const tile of sliced.tiles) {
    const g = classifyPlanCell(tile.pixels, cell);
    tile.role = g.role; tile.why = g.why;
  }
}
// 명도 우선 규칙 (단순)
const floorBright = Number(arg('floor-bright', '0')) || 0;
if (!flag('plan') && floorBright > 0) {
  for (const tile of sliced.tiles) {
    if (!tile.stats) continue;
    const g = guessRole(tile.stats, { floorBrightness: floorBright });
    tile.role = g.role; tile.why = g.why;
  }
}
console.log(`  합치기: ${dedup.exact ? '픽셀 완전 일치' : `근사 (격자 ${dedup.blocks}, 색 ${dedup.levels}단계)`}`);
console.log(`  ${sliced.cols}×${sliced.rows} = ${sliced.cols * sliced.rows}칸 → 고유 타일 ${sliced.tiles.length}장`);

// 교정 파일 적용
const rolesPath = arg('roles');
let overrides = {};
if (rolesPath) {
  overrides = JSON.parse(await readFile(resolve(rolesPath), 'utf8'));
  let applied = 0;
  for (const tile of sliced.tiles) {
    const want = overrides[String(tile.index)];
    if (want && want !== tile.role) { tile.role = want; tile.why = '교정'; applied += 1; }
  }
  console.log(`  교정 ${applied}건 적용 (${rolesPath})`);
}

const ROLE_META = {
  floor: { category: 'floor', movement: 'passable', walk: true },
  water: { category: 'obstacle_slowing', movement: 'slowed', walk: false },
  wall: { category: 'obstacle_blocking', movement: 'blocked', walk: false },
  furniture: { category: 'obstacle_blocking', movement: 'blocked', walk: false },
  plant: { category: 'obstacle_blocking', movement: 'blocked', walk: false },
  blocked: { category: 'obstacle_blocking', movement: 'blocked', walk: false },
  decoration: { category: 'decoration', movement: 'passable', walk: true },
  // 문은 열린 개구부로 본다 — 캐릭터가 지나다녀야 자연스럽다.
  // 마스크에는 노랑으로 표시돼 위치를 알 수 있고, 통행은 허용한다.
  door: { category: 'floor', movement: 'passable', walk: true },
  window: { category: 'obstacle_blocking', movement: 'blocked', walk: false },
  prop: { category: 'obstacle_blocking', movement: 'blocked', walk: false },
  outside: { category: 'floor', movement: 'passable', walk: true },
  empty: { category: 'floor', movement: 'passable', walk: true },
};

// 셀 단위 통행 교정 — 그림 위 격자에서 칠한 결과
const cellsPath = arg('cells');
let cellOverride = {};
if (cellsPath) {
  cellOverride = JSON.parse(await readFile(resolve(cellsPath), 'utf8'));
  console.log(`  격자 교정 ${Object.keys(cellOverride).length}칸 적용 (${cellsPath})`);
}

const byRole = {};
for (const tile of sliced.tiles) byRole[tile.role] = (byRole[tile.role] || 0) + 1;
console.log(`  판정: ${Object.entries(byRole).map(([k, v]) => `${k} ${v}`).join(' · ')}`);

// ── 3. 타일셋 시트 ────────────────────────────────────────
const TILE_ID_BASE = 2049;
const columns = Math.min(16, Math.max(4, Math.ceil(Math.sqrt(sliced.tiles.length))));
const rows = Math.ceil(sliced.tiles.length / columns);
const sheet = new Canvas(columns * target, rows * target);
const tileProperties = {};

sliced.tiles.forEach((tile, index) => {
  const ox = (index % columns) * target;
  const oy = Math.floor(index / columns) * target;
  for (let y = 0; y < cell; y += 1) {
    for (let x = 0; x < cell; x += 1) {
      const s = (y * cell + x) * 4;
      const a = tile.pixels[s + 3];
      if (a === 0) continue;
      const color = [tile.pixels[s], tile.pixels[s + 1], tile.pixels[s + 2], a];
      if (scaleUp >= 1) {
        for (let dy = 0; dy < scaleUp; dy += 1) {
          for (let dx = 0; dx < scaleUp; dx += 1) sheet.set(ox + x * scaleUp + dx, oy + y * scaleUp + dy, color);
        }
      } else {
        const step = Math.round(1 / scaleUp);
        if (x % step === 0 && y % step === 0) sheet.set(ox + x / step, oy + y / step, color);
      }
    }
  }
  const meta = ROLE_META[tile.role];
  const id = TILE_ID_BASE + index;
  tileProperties[String(id)] = {
    smoThemeId: key,
    smoThemeName: key,
    smoTileId: String(index + 1),
    name: `${tile.role} ${String(index + 1).padStart(2, '0')}`,
    category: meta.category,
    movement: meta.movement,
    interaction: 'none',
    blocksMovement: meta.movement === 'blocked',
    blocksVision: meta.movement === 'blocked',
    moveSpeed: meta.movement === 'blocked' ? 0 : (meta.movement === 'slowed' ? 0.55 : 1),
    sourceCells: [{ column: (index % columns) + 1, row: Math.floor(index / columns) + 1 }],
    imageStats: tile.stats,
    guessWhy: tile.why,
    roleHint: tile.role,
  };
});

const useJpeg = flag('jpeg');
const jpegQuality = Number(arg('jpeg', '85')) || 85;
const png = sheet.toPng();
const sheetBytes = useJpeg ? await encodeJpeg(sheet.width, sheet.height, sheet.data, jpegQuality) : png;
const sheetUrl = useJpeg
  ? `data:image/jpeg;base64,${Buffer.from(sheetBytes).toString('base64')}`
  : toDataUrl(png);
if (useJpeg) {
  console.log(`  시트 JPEG 품질 ${jpegQuality}: ${(png.length / 1024).toFixed(0)}KB → ${(sheetBytes.length / 1024).toFixed(0)}KB`);
}
const asset = {
  id: `theme_${key}`,
  name: key,
  kind: 'custom',
  imageUrl: sheetUrl,
  source: 'map-theme',
  themeId: key,
  themeName: key,
  tileProperties,
  tileIdBase: TILE_ID_BASE,
  tileWidth: target,
  tileHeight: target,
  sheetWidth: sheet.width,
  sheetHeight: sheet.height,
  createdAt: '',
  updatedAt: new Date().toISOString(),
};

// ── 4. 맵 레코드 — 이미지가 그대로 맵이 된다 ──────────────
const width = sliced.cols;
const height = sliced.rows;
// 셀별 역할을 먼저 확정한다 (마스크 → 짝 판독 → 칠하기 교정 순서로 덮어씀)
let finalRoles = new Array(width * height).fill('floor');
const cellBrightness = new Array(width * height).fill(0.5);
for (let row = 0; row < height; row += 1) {
  for (let col = 0; col < width; col += 1) {
    const at = row * width + col;
    const t = sliced.grid[at];
    finalRoles[at] = cellOverride[String(at)]
      || (pairRoles ? pairRoles[at] : null)
      || (t >= 0 ? sliced.tiles[t].role : 'floor');
    if (t >= 0 && sliced.tiles[t].stats) cellBrightness[at] = sliced.tiles[t].stats.hsv.v;
  }
}

// 끊긴 방 자동 개통
if (flag('connect')) {
  const result = autoConnect(width, height, finalRoles, cellBrightness, {
    maxCells: Number(arg('connect-max', '5')) || 5,
  });
  finalRoles = result.roles;
  const carved = result.openings.filter((o) => !o.skipped);
  const skipped = result.openings.filter((o) => o.skipped);
  console.log(`  자동 개통: 영역 ${result.before.groups.length}개 → ${result.after.groups.length}개 · ${carved.length}칸 뚫음`);
  for (const o of carved) {
    console.log(`    (${o.col},${o.row}) ${o.was} → 문 · 그림 밝기 ${o.brightness} · ${o.joined}칸 영역 연결`);
  }
  for (const o of skipped) {
    console.log(`    ⚠ ${o.size}칸 영역은 건너뜀 — ${o.need}칸을 뚫어야 해서 (--connect-max 로 조절)`);
  }
}

const back1 = createGrid(width, height);
const walkable = createGrid(width, height, NAV_OFF);
const obstacle = createGrid(width, height, NAV_OFF);
for (let row = 0; row < height; row += 1) {
  for (let col = 0; col < width; col += 1) {
    const t = sliced.grid[row * width + col];
    if (t < 0) continue;
    const i = idx(width, col, row);
    back1[i] = TILE_ID_BASE + t;
    const meta = ROLE_META[finalRoles[row * width + col]] || ROLE_META.floor;
    walkable[i] = meta.walk ? NAV_ON : NAV_OFF;
    obstacle[i] = meta.walk ? NAV_OFF : NAV_ON;
  }
}

const record = normalizeMapRecord({
  name: arg('name', key),
  description: `${basename(imagePath)} 에서 생성. ${width}×${height}칸 · 고유 타일 ${sliced.tiles.length}장 · 격자 ${cell}px → ${target}px`,
  width,
  height,
  tileSize: target,
  tileSetAssetId: asset.id,
  tilesets: [asset],
  layers: [
    { name: 'back_1', type: LAYER_TYPES.BACK, label: '이미지', data: back1 },
    { name: 'walkable', type: LAYER_TYPES.WALKABLE, data: walkable },
    { name: 'obstacle', type: LAYER_TYPES.OBSTACLE, data: obstacle },
  ],
  spawnPoints: [],
});

// 스폰은 **가장 넓은 연결 영역**에 놓는다. 첫 통행 칸을 쓰면 구석의 고립된
// 한 칸이 잡혀 "도달 15%" 같은 결과가 나온다 (실제로 그랬다).
const seenRegion = new Int32Array(width * height).fill(-1);
const regions = [];
for (let row = 0; row < height; row += 1) {
  for (let col = 0; col < width; col += 1) {
    const start = idx(width, col, row);
    if (walkable[start] !== NAV_ON || seenRegion[start] >= 0) continue;
    const id = regions.length;
    const cells = [];
    const queue = [start];
    seenRegion[start] = id;
    while (queue.length > 0) {
      const cur = queue.pop();
      cells.push(cur);
      const c = cur % width;
      const r = (cur - c) / width;
      for (const [nc, nr] of [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]]) {
        if (nc < 0 || nr < 0 || nc >= width || nr >= height) continue;
        const next = idx(width, nc, nr);
        if (walkable[next] !== NAV_ON || seenRegion[next] >= 0) continue;
        seenRegion[next] = id;
        queue.push(next);
      }
    }
    regions.push(cells);
  }
}
regions.sort((a, b) => b.length - a.length);
let spawn = null;
if (regions.length > 0) {
  const biggest = regions[0];
  const mid = biggest[Math.floor(biggest.length / 2)];
  spawn = { x: mid % width, y: (mid - (mid % width)) / width, label: '시작' };
  record.spawnPoints.push(spawn);
  const sizes = regions.slice(0, 4).map((r) => r.length).join(' · ');
  console.log(`  통행 영역 ${regions.length}개 (큰 것부터 ${sizes}${regions.length > 4 ? ' …' : ''})`);
}

const { errors, warnings } = validateMapRecord(record);
const walkTotal = walkable.filter((v) => v === NAV_ON).length;
let reached = 0;
if (spawn) {
  const seen = reachableFrom(record, spawn.x, spawn.y);
  reached = Array.from(seen).filter(Boolean).length;
}
console.log(`  통행 ${walkTotal}칸 / 전체 ${width * height}칸` + (spawn ? ` · 첫 스폰에서 도달 ${reached}칸 (${Math.round((reached / walkTotal) * 100)}%)` : ''));
for (const w of warnings) console.log(`  ⚠ ${w}`);
for (const e of errors) console.error(`  ✖ ${e}`);

// ── 5. 산출물 ─────────────────────────────────────────────
const themePath = resolve(`out/themes/${key}.json`);
await mkdir(dirname(themePath), { recursive: true });
await writeFile(resolve(`out/themes/${key}.${useJpeg ? 'jpg' : 'png'}`), sheetBytes);
await writeFile(themePath, JSON.stringify({ key, generatedAt: new Date().toISOString(), fromImage: imagePath, aliases: {}, asset }, null, 2), 'utf8');

// 교정용 HTML — 고유 타일만 보여주고 역할을 클릭으로 바꾼다
const cards = sliced.tiles.map((tile, index) => {
  const sx = (index % columns) * target;
  const sy = Math.floor(index / columns) * target;
  const s = tile.stats || {};
  return `<div class="card" data-i="${index}" data-role="${tile.role}">
    <div class="thumb" style="background-position:-${sx * 2}px -${sy * 2}px"></div>
    <div class="meta"><b>#${index}</b> ×${tile.count}
      <span class="role">${tile.role}</span>
      <small>${tile.why}</small>
      <small>rgb(${(s.rgb || []).join(',')}) h${s.hsv?.h ?? '-'} 평면${s.flat ?? '-'} 엣지${s.tileH ?? '-'}/${s.tileV ?? '-'}</small>
    </div></div>`;
}).join('\n');

const reviewHtml = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>${key} — 타일 역할 교정</title><style>
:root{color-scheme:dark}
body{margin:0;padding:20px;background:#14161a;color:#e6e8eb;font:13px/1.5 system-ui,"Noto Sans KR",sans-serif}
h1{font-size:17px;margin:0 0 4px}p{color:#9aa3ad;margin:0 0 14px}
#bar{position:sticky;top:0;background:#14161a;padding:10px 0;z-index:2;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
button{background:#22262c;color:#e6e8eb;border:1px solid #343a42;border-radius:6px;padding:6px 12px;cursor:pointer}
#grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}
.card{display:flex;gap:8px;padding:6px;border:1px solid #2b3038;border-radius:8px;background:#191c21;cursor:pointer}
.card:hover{border-color:#4a515b}
.thumb{width:${target * 2}px;height:${target * 2}px;flex:0 0 auto;image-rendering:pixelated;
  background-image:url("data:image/png;base64,${png.toString('base64')}");
  background-size:${columns * target * 2}px ${rows * target * 2}px}
.meta{display:flex;flex-direction:column;gap:1px;min-width:0}
.meta small{color:#7d858f;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.role{font-weight:700;padding:1px 6px;border-radius:4px;width:max-content}
[data-role=floor] .role{background:#1f4d33;color:#7ee2a8}
[data-role=water] .role{background:#1d3b57;color:#7cc4f0}
[data-role=blocked] .role{background:#4d2222;color:#f09a9a}
[data-role=decoration] .role{background:#4a3f1c;color:#e8cf7a}
[data-role=empty] .role{background:#2b3038;color:#9aa3ad}
#out{width:100%;height:90px;background:#0f1114;color:#9ee6b8;border:1px solid #2b3038;border-radius:6px;
  font:12px ui-monospace,monospace;padding:8px;margin-top:10px}
</style></head><body>
<h1>${key} — 타일 역할 교정</h1>
<p>${sliced.cols}×${sliced.rows} = ${sliced.cols * sliced.rows}칸 → 고유 타일 <b>${sliced.tiles.length}장</b>.
카드를 누르면 역할이 <b>floor → water → blocked → decoration</b> 순으로 바뀝니다.
다 고쳤으면 아래 JSON 을 복사해 <code>out/${key}-roles.json</code> 으로 저장하고
<code>--roles</code> 로 다시 돌리세요.</p>
<div id="bar">
  <button data-set="floor">전부 바닥</button>
  <button data-set="blocked">전부 차단</button>
  <button id="copy">JSON 복사</button>
  <span id="tally"></span>
</div>
<div id="grid">
${cards}
</div>
<textarea id="out" readonly></textarea>
<script>
const ORDER=['floor','water','blocked','decoration'];
const cards=[...document.querySelectorAll('.card')];
function refresh(){
  const roles={};
  const tally={};
  for(const c of cards){
    const r=c.dataset.role;
    roles[c.dataset.i]=r;
    tally[r]=(tally[r]||0)+1;
    c.querySelector('.role').textContent=r;
  }
  document.getElementById('out').value=JSON.stringify(roles);
  document.getElementById('tally').textContent=Object.entries(tally).map(([k,v])=>k+' '+v).join(' · ');
}
document.getElementById('grid').addEventListener('click',(e)=>{
  const card=e.target.closest('.card'); if(!card) return;
  const i=ORDER.indexOf(card.dataset.role);
  card.dataset.role=ORDER[(i+1)%ORDER.length];
  refresh();
});
for(const b of document.querySelectorAll('[data-set]')){
  b.addEventListener('click',()=>{ for(const c of cards) c.dataset.role=b.dataset.set; refresh(); });
}
document.getElementById('copy').addEventListener('click',()=>{
  const t=document.getElementById('out'); t.select();
  navigator.clipboard?.writeText(t.value);
});
refresh();
</script></body></html>`;
const reviewPath = resolve(`out/${key}-roles.html`);
await writeFile(reviewPath, reviewHtml, 'utf8');

// ── 격자 칠하기 — 그림 위에서 통행을 고친다 ────────────────
// 고유 타일이 수백 장이면 타일별 교정은 비현실적이다. 그림 위 격자에서
// 드래그로 칠하는 편이 훨씬 빠르다 (1,032칸이라도 몇 분).
const cellRoles = [];
for (let row = 0; row < height; row += 1) {
  for (let col = 0; col < width; col += 1) {
    const t = sliced.grid[row * width + col];
    const at = row * width + col;
    cellRoles.push(finalRoles[at]);
  }
}
const srcJpeg = await encodeJpeg(img.width, img.height, img.data, 82);
const paintScale = Math.max(1, Math.min(2, Math.round(1200 / img.width * 10) / 10));
const cellHtml = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>${key} — 통행 칠하기</title><style>
:root{color-scheme:dark}
body{margin:0;padding:16px;background:#14161a;color:#e6e8eb;font:13px/1.5 system-ui,"Noto Sans KR",sans-serif}
h1{font-size:16px;margin:0 0 4px}p{color:#9aa3ad;margin:0 0 10px}
#bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;position:sticky;top:0;background:#14161a;padding:8px 0;z-index:2}
button{background:#22262c;color:#e6e8eb;border:1px solid #343a42;border-radius:6px;padding:6px 12px;cursor:pointer}
button.on{outline:2px solid #ffcc4d}
#stage{position:relative;width:${Math.round(img.width * paintScale)}px;height:${Math.round(img.height * paintScale)}px;
  background:url("data:image/jpeg;base64,${Buffer.from(srcJpeg).toString('base64')}") 0 0/100% 100% no-repeat}
#grid{position:absolute;inset:0;display:grid;grid-template-columns:repeat(${width},1fr);grid-template-rows:repeat(${height},1fr)}
#grid i{border:0.5px solid rgba(255,255,255,.07)}
${roleCss('i')}
#grid.binary i{background:none}
${binaryCss('#grid.binary i')}
${LEGEND_CSS}
#out{width:100%;height:70px;margin-top:10px;background:#0f1114;color:#9ee6b8;border:1px solid #2b3038;
  border-radius:6px;font:11px ui-monospace,monospace;padding:8px}
</style></head><body>
<h1>${key} — 통행 칠하기</h1>
<p>${width}×${height} = ${width * height}칸.
<b>흐린 색 = 지나갈 수 있음 · 진한 색 = 막힘.</b> 색조가 이유를 말합니다.<br>
${legendHtml()}<br>
브러시를 고르고 <b>드래그</b>하세요. 고친 것만 JSON 으로 나옵니다 →
<code>out/${key}-cells.json</code> 으로 저장하고 <code>--cells</code> 로 다시 돌리세요.</p>
<div id="bar">
  <span>브러시:</span>
  <button data-b="floor" class="on">바닥</button>
  <button data-b="outside">야외</button>
  <button data-b="door">문</button>
  <button data-b="wall">벽</button>
  <button data-b="prop">가구</button>
  <button data-b="plant">식재</button>
  <button data-b="water">물</button>
  <label><input type="checkbox" id="show" checked> 오버레이</label>
  <label><input type="checkbox" id="bin"> 통행/막힘 2색만</label>
  <button id="copy">JSON 복사</button>
  <span id="tally"></span>
</div>
<div id="stage"><div id="grid"></div></div>
<textarea id="out" readonly></textarea>
<script>
const W=${width}, H=${height};
const roles=${JSON.stringify(cellRoles)};
const base=${JSON.stringify(cellRoles)};
const grid=document.getElementById('grid');
const cells=[];
for(let i=0;i<W*H;i++){const el=document.createElement('i');el.dataset.r=roles[i];grid.appendChild(el);cells.push(el);}
let brush='floor', painting=false;
function refresh(){
  const t={}; for(const r of roles) t[r]=(t[r]||0)+1;
  document.getElementById('tally').textContent=Object.entries(t).map(([k,v])=>k+' '+v).join(' · ');
  const diff={}; for(let i=0;i<roles.length;i++) if(roles[i]!==base[i]) diff[i]=roles[i];
  document.getElementById('out').value=JSON.stringify(diff);
}
function paint(el){const i=cells.indexOf(el); if(i<0||roles[i]===brush)return; roles[i]=brush; el.dataset.r=brush; refresh();}
grid.addEventListener('pointerdown',e=>{if(e.target.tagName==='I'){painting=true;paint(e.target);grid.setPointerCapture(e.pointerId);}});
grid.addEventListener('pointermove',e=>{if(!painting)return;const el=document.elementFromPoint(e.clientX,e.clientY);if(el&&el.tagName==='I')paint(el);});
addEventListener('pointerup',()=>{painting=false;});
for(const b of document.querySelectorAll('[data-b]')) b.addEventListener('click',()=>{
  brush=b.dataset.b; document.querySelectorAll('[data-b]').forEach(x=>x.classList.toggle('on',x===b));});
document.getElementById('show').addEventListener('change',e=>{grid.style.opacity=e.target.checked?1:0;});
document.getElementById('bin').addEventListener('change',e=>{grid.classList.toggle('binary',e.target.checked);});
document.getElementById('copy').addEventListener('click',()=>{const t=document.getElementById('out');t.select();navigator.clipboard?.writeText(t.value);});
refresh();
</script></body></html>`;
const cellPath = resolve(`out/${key}-cells.html`);
await writeFile(cellPath, cellHtml, 'utf8');

console.log('');
console.log(`[map-from-image] 테마     → ${themePath}`);
console.log(`[map-from-image] 시트     → out/themes/${key}.${useJpeg ? 'jpg' : 'png'}  (${(sheetBytes.length / 1024).toFixed(1)}KB)`);
console.log(`[map-from-image] 통행칠하기 → ${cellPath}   ← 이걸 쓰세요`);
console.log(`[map-from-image] 타일교정   → ${reviewPath}   (고유 타일이 적을 때만 유용)`);

if (flag('html')) {
  const { renderPreviewHtml } = await import('../src/map-preview.mjs');
  const { normalizeTheme, mergeThemes } = await import('../src/spum-theme.mjs');
  const theme = mergeThemes([{ key, theme: normalizeTheme(asset, { aliases: {} }) }]);
  const htmlPath = resolve(`out/${key}-preview.html`);
  await writeFile(htmlPath, renderPreviewHtml(record, { theme, scale: Number(arg('scale', '1')) || 1 }), 'utf8');
  console.log(`[map-from-image] 미리보기 → ${htmlPath}`);
}
if (flag('snippet')) {
  const snippetPath = resolve(`out/${key}-snippet.js`);
  await writeFile(snippetPath, buildMapSnippet(record), 'utf8');
  console.log(`[map-from-image] 스니펫   → ${snippetPath}`);
}
