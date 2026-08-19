#!/usr/bin/env node
/**
 * 건축 도면 이미지 → SPUM 맵.
 *
 * 도면은 타일맵이 아니다. 격자가 없고 벽이 얇은 선이라, 그림을 타일로 쓰면
 * 흐릿한 죽이 된다. 그래서 **마스크로만 읽고 그림은 테마 타일로 칠한다**.
 *
 * ★ 자동으로 되는 것과 안 되는 것 (2026-08-19 실측)
 *   된다  : 벽 · 바닥 · 외부 여백 · 물(파랑이 있으면)
 *   안 된다: 식재 — 지중해 도면은 세피아 단색조라 초록 픽셀이 0.1%(96개)뿐이었다.
 *           색으로 구분할 근거가 없다. 그래서 **칠해서 고치는 화면**을 같이 낸다.
 *
 * 사용:
 *   node scripts/map-from-blueprint.mjs --image <도면> --crop x,y,w,h --grid 64x46 \
 *        --theme out/themes/med.json [--roles out/<key>-mask.json] --snippet --html
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { loadImage, cropImage, findPanels } from '../src/image-io.mjs';
import { encodePng } from '../src/png.mjs';
import { readBlueprint, readColorMask, closeWallGaps, downsampleMask, maskAscii, MASK_LEGEND } from '../src/blueprint.mjs';
import { normalizeMapRecord, LAYER_TYPES, NAV_ON, NAV_OFF, createGrid, idx, validateMapRecord, reachableFrom } from '../src/spum-map.mjs';
import { normalizeTheme, mergeThemes, resolveTileRef, themesToTilesetAssets } from '../src/spum-theme.mjs';
import { buildMapSnippet } from '../src/studio-snippet.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const imagePath = arg('image');
if (!imagePath) {
  console.error(`사용법: node scripts/map-from-blueprint.mjs --image <도면> [옵션]

  --panels           흰 여백으로 나뉜 판 목록만 출력하고 끝낸다 (합성 도면에서 좌표 찾기)
  --crop x,y,w,h     쓸 영역
  --grid 48x34       결과 맵 칸 수
  --color-mask       색 코드 마스크로 판독 (AI 에게 색으로 그려달라 한 경우). 훨씬 정확하다
  --read-scale 3     판독 해상도 배율 (기본 3). 벽선이 얇으면 올린다
  --wall-threshold   벽 판정 임계 (기본 0.5). 가구가 벽으로 잡히면 올린다
  --theme <파일>     칠할 타일 테마 (필수)
  --map <파일>       역할→타일 배정 (기본 bake/blueprint-med.json)
  --roles <파일>     마스크 교정 파일 (칠하기 화면에서 복사한 것)
  --name <이름>      맵 이름
  --snippet --html --scale <배율>`);
  process.exit(1);
}

const img = await loadImage(resolve(imagePath));
const key = (arg('key') || basename(imagePath).replace(/\.[^.]+$/, '')).replace(/[^\w가-힣-]+/g, '-').slice(0, 40);
console.log(`[blueprint] ${basename(imagePath)} · ${img.width}×${img.height}`);

if (flag('panels')) {
  const { panels, rowBands, colBands } = findPanels(img, { whiteThreshold: 225 });
  console.log(`  행 밴드 ${JSON.stringify(rowBands)} · 열 밴드 ${JSON.stringify(colBands)}`);
  panels.forEach((p, i) => console.log(`  판 ${i}: --crop ${p.x},${p.y},${p.width},${p.height}`));
  process.exit(0);
}

// ── 1. 영역 자르기 ────────────────────────────────────────
const cropArg = arg('crop');
const panel = cropArg
  ? cropImage(img, ...cropArg.split(',').map(Number))
  : img;
console.log(`  영역 ${panel.width}×${panel.height}${cropArg ? ` (crop ${cropArg})` : ' (전체)'}`);

// ── 2. 판독 ───────────────────────────────────────────────
const [cols, rows] = String(arg('grid', '48x34')).split('x').map(Number);
let mask;
if (flag('color-mask')) {
  // 색 코드 마스크 — AI 에게 요구한 색을 그대로 읽는다. 셀별 최다 득표.
  mask = readColorMask(panel, cols, rows);
  console.log(`  색 코드 판독 ${cols}×${rows}` + (mask.lowConfidence ? ` · 저신뢰 ${mask.lowConfidence}칸 (색이 섞인 경계)` : ' · 저신뢰 0칸'));
} else {
  // 판독은 목표보다 촘촘하게 — 벽선(3~5px)이 셀을 꽉 채워야 가구와 구분된다
  const readScale = Math.max(1, Number(arg('read-scale', '3')) || 3);
  const fine = closeWallGaps(readBlueprint(panel, cols * readScale, rows * readScale, {
    wall: Number(arg('wall-threshold', '0.5')) || 0.5,
  }));
  mask = readScale === 1 ? fine : downsampleMask(fine, cols, rows);
  const fineTally = {};
  for (const r of fine.roles) fineTally[r] = (fineTally[r] || 0) + 1;
  console.log(`  명도 판독 ${cols * readScale}×${rows * readScale} (${readScale}배) · 벽 구멍 ${fine.closedGaps}칸 메움 · ${Object.entries(fineTally).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`  → 격자 ${cols}×${rows} = ${cols * rows}칸 으로 축소 (벽 우선)`);
}

const rolesPath = arg('roles');
if (rolesPath) {
  const overrides = JSON.parse(await readFile(resolve(rolesPath), 'utf8'));
  const next = [...mask.roles];
  let applied = 0;
  for (const [at, role] of Object.entries(overrides)) {
    const i = Number(at);
    if (Number.isInteger(i) && i >= 0 && i < next.length && next[i] !== role) { next[i] = role; applied += 1; }
  }
  mask = { ...mask, roles: next };
  console.log(`  교정 ${applied}칸 적용 (${rolesPath})`);
}

const tally = {};
for (const r of mask.roles) tally[r] = (tally[r] || 0) + 1;
console.log(`  판독: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' · ')}`);

// ── 3. 역할 → 타일 ────────────────────────────────────────
const themePath = arg('theme');
if (!themePath) { console.error('  ✖ --theme 이 필요합니다 (칠할 타일셋).'); process.exit(1); }
const rawTheme = JSON.parse(await readFile(resolve(themePath), 'utf8'));
const theme = mergeThemes([{ key: rawTheme.key || 'theme', theme: normalizeTheme(rawTheme.asset || rawTheme, { aliases: rawTheme.aliases || {} }) }]);

const mapping = JSON.parse(await readFile(resolve(arg('map', 'bake/blueprint-med.json')), 'utf8'));
function pick(role, col, row) {
  const spec = mapping[role];
  if (spec == null) return null;
  const list = Array.isArray(spec) ? spec : [spec];
  const h = Math.imul(col + 1, 0x9e3779b1) ^ Math.imul(row + 1, 0x85ebca6b);
  const chosen = list[Math.abs((h >>> 13) % list.length)];
  return chosen ? resolveTileRef(theme, chosen, { label: `map.${role}` }) : null;
}

const back1 = createGrid(cols, rows);
const back2 = createGrid(cols, rows);
const front1 = createGrid(cols, rows);
const walkable = createGrid(cols, rows, NAV_OFF);
const obstacle = createGrid(cols, rows, NAV_OFF);

const LAYER_OF = { wall: 'back2', plant: 'front1', prop: 'front1' };
const WALKS = { floor: true, outside: true, door: true, water: false, wall: false, plant: false, prop: false };

for (let row = 0; row < rows; row += 1) {
  for (let col = 0; col < cols; col += 1) {
    const at = row * cols + col;
    const role = mask.roles[at];
    const i = idx(cols, col, row);
    // 바닥은 항상 깐다 — 벽·식재도 그 아래 바닥이 있어야 빈 칸으로 안 보인다
    const base = pick(['wall', 'plant', 'prop', 'door'].includes(role) ? 'floor' : role, col, row);
    if (base) back1[i] = base;
    const tile = pick(role, col, row);
    if (tile && LAYER_OF[role] === 'back2') back2[i] = tile;
    else if (tile && LAYER_OF[role] === 'front1') front1[i] = tile;
    else if (tile && role !== 'floor' && role !== 'outside') back1[i] = tile;
    const walk = WALKS[role] !== false;
    walkable[i] = walk ? NAV_ON : NAV_OFF;
    obstacle[i] = walk ? NAV_OFF : NAV_ON;
  }
}

const record = normalizeMapRecord({
  name: arg('name', key),
  description: `${basename(imagePath)} 도면 판독. ${cols}×${rows}칸 · ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' · ')}`,
  width: cols,
  height: rows,
  tileSize: theme.tileWidth || 32,
  tileSetAssetId: theme.assetId,
  tilesets: themesToTilesetAssets(theme),
  layers: [
    { name: 'back_1', type: LAYER_TYPES.BACK, label: '바닥', data: back1 },
    { name: 'back_2', type: LAYER_TYPES.BACK, label: '벽', data: back2 },
    { name: 'front_1', type: LAYER_TYPES.FRONT, label: '식재', data: front1 },
    { name: 'walkable', type: LAYER_TYPES.WALKABLE, data: walkable },
    { name: 'obstacle', type: LAYER_TYPES.OBSTACLE, data: obstacle },
  ],
  spawnPoints: [],
});

// 스폰 — 가장 넓은 연결 영역
const seenRegion = new Int32Array(cols * rows).fill(-1);
const regions = [];
for (let row = 0; row < rows; row += 1) {
  for (let col = 0; col < cols; col += 1) {
    const start = idx(cols, col, row);
    if (walkable[start] !== NAV_ON || seenRegion[start] >= 0) continue;
    const id = regions.length; const cells = []; const queue = [start];
    seenRegion[start] = id;
    while (queue.length) {
      const cur = queue.pop(); cells.push(cur);
      const c = cur % cols; const r = (cur - c) / cols;
      for (const [nc, nr] of [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]]) {
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const next = idx(cols, nc, nr);
        if (walkable[next] !== NAV_ON || seenRegion[next] >= 0) continue;
        seenRegion[next] = id; queue.push(next);
      }
    }
    regions.push(cells);
  }
}
regions.sort((a, b) => b.length - a.length);
if (regions.length) {
  const mid = regions[0][Math.floor(regions[0].length / 2)];
  record.spawnPoints.push({ x: mid % cols, y: (mid - (mid % cols)) / cols, label: '시작' });
  console.log(`  통행 영역 ${regions.length}개 (큰 것부터 ${regions.slice(0, 5).map((r) => r.length).join(' · ')}${regions.length > 5 ? ' …' : ''})`);
}

const { errors, warnings } = validateMapRecord(record);
const walkTotal = walkable.filter((v) => v === NAV_ON).length;
if (record.spawnPoints.length) {
  const seen = reachableFrom(record, record.spawnPoints[0].x, record.spawnPoints[0].y);
  const reached = Array.from(seen).filter(Boolean).length;
  console.log(`  통행 ${walkTotal}칸 · 도달 ${reached}칸 (${Math.round((reached / walkTotal) * 100)}%)`);
}
for (const w of warnings) console.log(`  ⚠ ${w}`);
for (const e of errors) console.error(`  ✖ ${e}`);

if (flag('ascii')) { console.log(''); console.log(maskAscii(mask)); console.log(''); }

// ── 4. 칠하기 교정 화면 ───────────────────────────────────
const panelPng = encodePng(panel.width, panel.height, panel.data);
const paintHtml = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>${key} — 마스크 칠하기</title><style>
:root{color-scheme:dark}
body{margin:0;padding:16px;background:#14161a;color:#e6e8eb;font:13px/1.5 system-ui,"Noto Sans KR",sans-serif}
h1{font-size:16px;margin:0 0 4px}p{color:#9aa3ad;margin:0 0 10px}
#bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
button{background:#22262c;color:#e6e8eb;border:1px solid #343a42;border-radius:6px;padding:6px 12px;cursor:pointer}
button.on{outline:2px solid #ffcc4d}
#stage{position:relative;width:${panel.width * 2}px;height:${panel.height * 2}px;image-rendering:pixelated;
  background:url("data:image/png;base64,${panelPng.toString('base64')}") 0 0/100% 100% no-repeat}
#grid{position:absolute;inset:0;display:grid;grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr)}
#grid i{border:0.5px solid rgba(255,255,255,.06)}
i[data-r=wall]{background:rgba(240,90,90,.55)}
i[data-r=floor]{background:rgba(120,220,160,.20)}
i[data-r=plant]{background:rgba(90,220,120,.60)}
i[data-r=water]{background:rgba(90,170,240,.60)}
i[data-r=outside]{background:rgba(0,0,0,.35)}
#out{width:100%;height:70px;margin-top:10px;background:#0f1114;color:#9ee6b8;border:1px solid #2b3038;
  border-radius:6px;font:11px ui-monospace,monospace;padding:8px}
</style></head><body>
<h1>${key} — 마스크 칠하기</h1>
<p>도면 위에 판독 결과가 덮여 있습니다. 브러시를 고르고 <b>드래그</b>해서 고치세요.
색으로 자동 판정이 안 되는 <b>식재</b>는 여기서 칠하면 됩니다
(이 도면은 초록 픽셀이 0.1%뿐이라 자동 판정 근거가 없습니다).
다 고쳤으면 아래 JSON 을 <code>out/${key}-mask.json</code> 으로 저장하고 <code>--roles</code> 로 다시 돌리세요.</p>
<div id="bar">
  <span>브러시:</span>
  <button data-b="wall" class="on">벽</button>
  <button data-b="floor">바닥</button>
  <button data-b="plant">식재</button>
  <button data-b="water">물</button>
  <button data-b="outside">외부</button>
  <label><input type="checkbox" id="show" checked> 오버레이 표시</label>
  <button id="copy">JSON 복사</button>
  <span id="tally"></span>
</div>
<div id="stage"><div id="grid"></div></div>
<textarea id="out" readonly></textarea>
<script>
const COLS=${cols}, ROWS=${rows};
const roles=${JSON.stringify(mask.roles)};
const base=${JSON.stringify(mask.roles)};
const grid=document.getElementById('grid');
const cells=[];
for(let i=0;i<COLS*ROWS;i++){const el=document.createElement('i');el.dataset.r=roles[i];grid.appendChild(el);cells.push(el);}
let brush='wall', painting=false;
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
document.getElementById('copy').addEventListener('click',()=>{const t=document.getElementById('out');t.select();navigator.clipboard?.writeText(t.value);});
refresh();
</script></body></html>`;

const paintPath = resolve(`out/${key}-mask.html`);
await mkdir(dirname(paintPath), { recursive: true });
await writeFile(paintPath, paintHtml, 'utf8');
console.log('');
console.log(`[blueprint] 칠하기 → ${paintPath}`);

if (flag('html')) {
  const { renderPreviewHtml } = await import('../src/map-preview.mjs');
  const p = resolve(`out/${key}-preview.html`);
  await writeFile(p, renderPreviewHtml(record, { theme, scale: Number(arg('scale', '1')) || 1 }), 'utf8');
  console.log(`[blueprint] 미리보기 → ${p}`);
}
if (flag('snippet')) {
  const p = resolve(`out/${key}-snippet.js`);
  await writeFile(p, buildMapSnippet(record), 'utf8');
  console.log(`[blueprint] 스니펫 → ${p}`);
}
