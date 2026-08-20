/**
 * AI 가 그린 조감도 한 장 → SPUM 맵.
 *
 * 타일을 반복 배치하는 보통 맵과 정반대다. 씬 전체를 격자로 잘라 **모든 칸을 고유 타일로**
 * 등록하고 원래 좌표에 그대로 놓는다. 그러면 그림이 픽셀 단위로 복원된다.
 *
 * 통행 판정은 그림에 정보가 없으므로 픽셀에서 추정한다:
 *   바닥 = 밝고 채도 낮은 회색 · 설비/벽/가구 = 어둡거나 색이 있다.
 *
 * 사용: node scripts/scene-to-map.mjs --image <조감도.png> --name "<맵 이름>" [--mask]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { decodePng, Canvas, toDataUrl } from '../src/png.mjs';
import jpeg from 'jpeg-js';

const args = process.argv.slice(2);
const arg = (n, d = null) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : d; };
const imagePath = arg('--image');
const mapName = arg('--name', '우주선 조감도');
const cell = Number(arg('--cell', 32));
const wantMask = args.includes('--mask');
const jpegQuality = Number(arg('--jpeg', 0));   // >0 이면 시트를 JPEG 로 굽는다 (용량 절감)
const maskImage = arg('--maskimage');
const doConnect = args.includes('--connect');   // 고립 구역을 메인에 이어 붙인다   // AI 가 만든 흑백 통행 마스크 (있으면 이걸 쓴다)
const brightMin = Number(arg('--bright', 118));   // 이 밝기 이상이면 바닥 후보
const satMax = Number(arg('--sat', 34));          // 채도가 이보다 크면 사물로 본다
const stdMax = Number(arg('--std', 30));          // 밝기 편차가 크면 무언가 그려진 칸이다

if (!imagePath) { console.error('사용법: node scripts/scene-to-map.mjs --image <png> --name "<맵 이름>"'); process.exit(1); }

const TILE_ID_BASE = 2049;
const src = decodePng(await readFile(imagePath));
const cols = Math.floor(src.width / cell);
const rows = Math.floor(src.height / cell);
console.log(`[scene-to-map] 원본 ${src.width}×${src.height} · 셀 ${cell}px → ${cols}×${rows} = ${cols * rows}칸`);

/** 셀 하나의 통계 */
function cellStats(cx, cy) {
  let sum = 0, sum2 = 0, rS = 0, gS = 0, bS = 0, n = 0;
  for (let y = 0; y < cell; y += 1) {
    for (let x = 0; x < cell; x += 1) {
      const i = ((cy * cell + y) * src.width + (cx * cell + x)) * 4;
      const r = src.data[i], g = src.data[i + 1], b = src.data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      sum += lum; sum2 += lum * lum; rS += r; gS += g; bS += b; n += 1;
    }
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  const r = rS / n, g = gS / n, b = bS / n;
  const sat = Math.max(r, g, b) - Math.min(r, g, b);   // 회색이면 0에 가깝다
  return { mean, std, sat };
}

const walkable = new Uint8Array(cols * rows);

if (maskImage) {
  // ★ AI 가 img2img 로 만든 흑백 마스크로 판정한다.
  //   씬 픽셀만 보고 추정하면 바닥(밝기 77~110)과 설비(53~82)가 겹쳐 구분이 안 된다
  //   (2026-08-20 실측: 그 방식은 통행 0칸이 나왔다). 마스크는 흑백이라 명확하다.
  const m = decodePng(await readFile(maskImage));
  const sx = m.width / src.width, sy = m.height / src.height;
  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < cols; cx += 1) {
      let sum = 0, n = 0;
      for (let y = 4; y < cell - 4; y += 1) {           // 격자선을 피해 안쪽만 본다
        for (let x = 4; x < cell - 4; x += 1) {
          const i = (Math.floor((cy * cell + y) * sy) * m.width + Math.floor((cx * cell + x) * sx)) * 4;
          sum += 0.299 * m.data[i] + 0.587 * m.data[i + 1] + 0.114 * m.data[i + 2];
          n += 1;
        }
      }
      walkable[cy * cols + cx] = (sum / n) > 127 ? 1 : 0;
    }
  }
  console.log(`[scene-to-map] 마스크로 판정: ${maskImage}`);
} else {
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const s = cellStats(x, y);
      walkable[y * cols + x] = (s.mean >= brightMin && s.sat <= satMax && s.std <= stdMax) ? 1 : 0;
    }
  }
}
const walkCount = walkable.reduce((a, v) => a + v, 0);
console.log(`[scene-to-map] 통행 ${walkCount}칸 / 막힘 ${cols * rows - walkCount}칸 (${Math.round(walkCount / (cols * rows) * 100)}% 통행)`);

// ── 고립 구역 잇기 ──
// 마스크가 문턱까지 막아 방이 통째로 갈라지는 일이 잦다 (2026-08-20: 5구역으로 분리,
// 침실 67칸·화물칸 101칸이 고립). 막힌 칸을 **최소 개수만** 뚫어 메인에 붙인다.
function groupsOf(w) {
  const seen = new Uint8Array(w.length), out = [];
  for (let i = 0; i < w.length; i += 1) {
    if (!w[i] || seen[i]) continue;
    const st = [i], g = []; seen[i] = 1;
    while (st.length) {
      const c = st.pop(); g.push(c);
      const cx = c % cols, cy = (c / cols) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const ni = ny * cols + nx;
        if (w[ni] && !seen[ni]) { seen[ni] = 1; st.push(ni); }
      }
    }
    out.push(g);
  }
  return out.sort((a, b) => b.length - a.length);
}

if (doConnect) {
  let opened = 0;
  for (let round = 0; round < 12; round += 1) {
    const gs = groupsOf(walkable);
    if (gs.length <= 1) break;
    const main = new Set(gs[0]);
    const island = gs[1];

    // 0-1 BFS: 통행 칸으로 가는 건 비용 0, 막힌 칸을 뚫는 건 비용 1.
    // 같은 거리는 현재 큐에, 한 칸 더 뚫어야 하면 다음 큐에 넣는다.
    const INF = 1e9;
    const dist = new Int32Array(cols * rows).fill(INF);
    const prev = new Int32Array(cols * rows).fill(-1);
    let cur = [], next = [];
    for (const i of island) { dist[i] = 0; cur.push(i); }
    let d = 0, target = -1;
    while (cur.length || next.length) {
      if (!cur.length) { cur = next; next = []; d += 1; }
      const c = cur.pop();
      if (c === undefined || dist[c] !== d) continue;
      if (main.has(c)) { target = c; break; }
      const cx = c % cols, cy = (c / cols) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const ni = ny * cols + nx;
        const w = walkable[ni] ? 0 : 1;
        if (d + w < dist[ni]) { dist[ni] = d + w; prev[ni] = c; (w === 0 ? cur : next).push(ni); }
      }
    }
    if (target < 0) break;
    for (let c = target; c !== -1; c = prev[c]) {
      if (!walkable[c]) { walkable[c] = 1; opened += 1; }
    }
  }
  if (opened) console.log(`[scene-to-map] 고립 구역을 잇느라 ${opened}칸을 뚫었습니다`);
}

// ── 연결성: 가장 큰 통행 덩어리만 남긴다 (섬처럼 떨어진 칸은 못 간다) ──
const seen = new Uint8Array(cols * rows);
let best = [], bestSize = 0;
for (let i = 0; i < walkable.length; i += 1) {
  if (!walkable[i] || seen[i]) continue;
  const stack = [i], group = [];
  seen[i] = 1;
  while (stack.length) {
    const cur = stack.pop(); group.push(cur);
    const cx = cur % cols, cy = (cur / cols) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (walkable[ni] && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
    }
  }
  if (group.length > bestSize) { bestSize = group.length; best = group; }
}
const keep = new Set(best);
let trimmed = 0;
for (let i = 0; i < walkable.length; i += 1) {
  if (walkable[i] && !keep.has(i)) { walkable[i] = 0; trimmed += 1; }
}
console.log(`[scene-to-map] 최대 연결 구역 ${bestSize}칸 · 떨어진 ${trimmed}칸은 막음`);

// ── 판정 확인용 마스크 이미지 ──
if (wantMask) {
  const m = new Canvas(src.width, src.height);
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const i = (y * src.width + x) * 4;
      const ci = ((y / cell) | 0) * cols + ((x / cell) | 0);
      const w = walkable[ci];
      m.set(x, y, [
        Math.round(src.data[i] * 0.55 + (w ? 0 : 120) * 0.45),
        Math.round(src.data[i + 1] * 0.55 + (w ? 200 : 0) * 0.45),
        Math.round(src.data[i + 2] * 0.55 + (w ? 90 : 0) * 0.45),
        255,
      ]);
    }
  }
  await mkdir('out', { recursive: true });
  await writeFile('out/scene-walkmask.png', m.toPng());
  console.log('[scene-to-map] 판정 확인용: out/scene-walkmask.png (초록=통행, 빨강=막힘)');
}

// ── 타일 속성: 칸마다 하나씩 ──
const tileProperties = {};
for (let y = 0; y < rows; y += 1) {
  for (let x = 0; x < cols; x += 1) {
    const idx = y * cols + x;
    const id = TILE_ID_BASE + idx;
    const blocked = !walkable[idx];
    // ★ 1024칸이라 필드 하나가 곧 수십 KB 다. localStorage 한도(2026-08-20 QuotaExceeded)를
    //   넘지 않도록 Studio 가 실제로 읽는 것만 남긴다.
    tileProperties[String(id)] = {
      category: blocked ? 'obstacle_blocking' : 'floor',
      movement: blocked ? 'blocked' : 'passable',
      blocksMovement: blocked, blocksVision: false,
      moveSpeed: blocked ? 0 : 1,
    };
  }
}

// ── 시트 이미지: PNG 그대로면 data URL 이 2.3MB 라 localStorage 를 넘긴다 ──
let sheetDataUrl;
if (jpegQuality > 0) {
  const rgba = Buffer.alloc(src.width * src.height * 4);
  src.data.forEach((v, i) => { rgba[i] = v; });
  const enc = jpeg.encode({ data: rgba, width: src.width, height: src.height }, jpegQuality);
  sheetDataUrl = `data:image/jpeg;base64,${Buffer.from(enc.data).toString('base64')}`;
  console.log(`[scene-to-map] 시트 JPEG q${jpegQuality}: ${Math.round(enc.data.length / 1024)}KB (PNG 대비 압축)`);
} else {
  sheetDataUrl = toDataUrl(await readFile(imagePath));
}

// ── 맵 레코드 ──
const layer = (name, type, data) => ({ name, type, visible: true, opacity: 1, data });
const ground = new Array(cols * rows);
for (let i = 0; i < cols * rows; i += 1) ground[i] = TILE_ID_BASE + i;

const now = new Date().toISOString();
const record = {
  id: `MAP_scene_${Math.random().toString(36).slice(2, 10)}`,
  name: mapName,
  width: cols, height: rows, tileWidth: cell, tileHeight: cell,
  layers: [
    layer('back_1', 'tile', ground),
    layer('back_2', 'tile', new Array(cols * rows).fill(0)),
    layer('front_1', 'tile', new Array(cols * rows).fill(0)),
    layer('walkable', 'nav', Array.from(walkable)),
    layer('obstacle', 'nav', Array.from(walkable).map((v) => (v ? 0 : 1))),
  ],
  tilesets: [{
    tileSetAssetId: 'theme_ship_scene',
    tileIdBase: TILE_ID_BASE,
    tileWidth: cell, tileHeight: cell,
    columns: cols, tileCount: cols * rows,
    imageUrl: sheetDataUrl,
    tiles: [],
    tileProperties,
  }],
  objects: [],
  spawnPoints: [],
  meta: { createdAt: now, updatedAt: now, source: 'scene-to-map', image: path.basename(imagePath) },
};

// 스폰: 가장 큰 통행 구역의 중앙쯤
const firstWalk = best.length ? best[Math.floor(best.length / 2)] : 0;
record.spawnPoints.push({ id: 'spawn_main', name: '시작 지점', x: firstWalk % cols, y: (firstWalk / cols) | 0 });

await mkdir('out', { recursive: true });
const outPath = arg('--out') || path.join('out', 'scene-map.json');
await writeFile(outPath, JSON.stringify(record, null, 2), 'utf8');
console.log(`[scene-to-map] → ${outPath}  (${cols}×${rows} · 타일 ${cols * rows}종)`);
