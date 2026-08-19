#!/usr/bin/env node
/**
 * 외부 타일 시트에서 필요한 타일만 골라 SPUM 맵 테마로 만든다.
 *
 * 왜 다시 포장하나:
 *   SPUM 의 `_loadTileSetFromAsset` 은 TileSet 에 `firstId` 만 넘긴다 — margin/spacing 을
 *   주지 않는다. 그래서 타일 사이에 1px 여백이 있는 시트(Kenney 팩)를 그대로 쓰면
 *   전부 어긋나게 잘린다. 여백 0 으로 다시 포장해야 한다.
 *   덤으로 필요한 타일만 모으니 시트가 작아지고(localStorage 에 들어간다), 배율도 맞춘다.
 *
 * 사용: node scripts/import-tileset.mjs --spec bake/tileset-mediterranean.json
 * 결과: out/themes/<key>.json · out/themes/<key>.png (시트 확인용)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { Canvas, decodePng, toDataUrl } from '../src/png.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const specPath = arg('spec');
if (!specPath) {
  console.error('사용법: node scripts/import-tileset.mjs --spec bake/tileset-mediterranean.json');
  process.exit(1);
}
const spec = JSON.parse(await readFile(resolve(specPath), 'utf8'));

const src = decodePng(await readFile(resolve(spec.source)));
const srcTile = Number(spec.srcTileSize) || 16;
const srcStride = srcTile + (Number(spec.srcMargin) || 0);
const outTile = Number(spec.outTileSize) || 32;
const scale = outTile / srcTile;
if (!Number.isInteger(scale) || scale < 1) {
  console.error(`outTileSize(${outTile}) 는 srcTileSize(${srcTile}) 의 정수배여야 합니다.`);
  process.exit(1);
}

const srcCols = Math.floor((src.width + (Number(spec.srcMargin) || 0)) / srcStride);
const srcRows = Math.floor((src.height + (Number(spec.srcMargin) || 0)) / srcStride);
console.log(`[import-tileset] 원본 ${src.width}×${src.height} · ${srcCols}×${srcRows} 타일 (${srcTile}px, 여백 ${spec.srcMargin || 0}px)`);

// 영역 단위 수집 — 팩의 한 구역을 통째로 가져온다.
// 손으로 고른 타일(spec.tiles)이 앞에 오고, 영역은 뒤에 붙는다.
// 별칭은 `<접두사>_<원본열>_<원본행>` 이라 나중에 원본 좌표를 되짚을 수 있다.
// 분류는 불투명도로 추정한다 — 꽉 찬 타일은 바닥, 투명이 섞이면 사물.
function pixelFill(col, row) {
  let opaque = 0;
  for (let y = 0; y < srcTile; y += 1) {
    for (let x = 0; x < srcTile; x += 1) {
      const i = ((row * srcStride + y) * src.width + (col * srcStride + x)) * 4;
      if (src.data[i + 3] > 200) opaque += 1;
    }
  }
  return opaque / (srcTile * srcTile);
}

const regionTiles = [];
for (const region of Array.isArray(spec.regions) ? spec.regions : []) {
  const [c0, r0] = region.from;
  const [w, h] = region.size;
  const prefix = String(region.aliasPrefix || 'src');
  const floorThreshold = Number(region.floorThreshold ?? 0.92);
  for (let dr = 0; dr < h; dr += 1) {
    for (let dc = 0; dc < w; dc += 1) {
      const col = c0 + dc;
      const row = r0 + dr;
      if (col >= srcCols || row >= srcRows) continue;
      const fill = pixelFill(col, row);
      if (fill < 0.02) continue;                       // 빈 칸은 건너뛴다
      const solid = fill >= floorThreshold;
      regionTiles.push({
        alias: `${prefix}_${col}_${row}`,
        at: [col, row],
        category: solid ? 'floor' : 'obstacle_blocking',
        movement: solid ? 'passable' : 'blocked',
        name: `${prefix} ${col},${row}`,
      });
    }
  }
}

const tiles = [...(Array.isArray(spec.tiles) ? spec.tiles : []), ...regionTiles];
const columns = Math.max(1, Number(spec.columns) || 8);
const rows = Math.ceil(tiles.length / columns);
const sheet = new Canvas(columns * outTile, rows * outTile);

function pixelAt(sx, sy) {
  if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) return [0, 0, 0, 0];
  const i = (sy * src.width + sx) * 4;
  return [src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3]];
}

const TILE_ID_BASE = Number(spec.tileIdBase) || 2049;
const tileProperties = {};
const aliases = {};
const report = [];

tiles.forEach((tile, index) => {
  const [col, row] = tile.at;
  if (col < 0 || row < 0 || col >= srcCols || row >= srcRows) {
    console.error(`  ✖ tiles[${index}] "${tile.alias}": 원본 격자(${srcCols}×${srcRows}) 밖 (${col},${row})`);
    process.exit(1);
  }
  const ox = (index % columns) * outTile;
  const oy = Math.floor(index / columns) * outTile;
  let opaque = 0;
  for (let y = 0; y < srcTile; y += 1) {
    for (let x = 0; x < srcTile; x += 1) {
      const [r, g, b, a] = pixelAt(col * srcStride + x, row * srcStride + y);
      if (a > 200) opaque += 1;
      if (a === 0) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          sheet.set(ox + x * scale + dx, oy + y * scale + dy, [r, g, b, a]);
        }
      }
    }
  }

  const id = TILE_ID_BASE + index;
  const blocked = tile.movement === 'blocked';
  const slowed = tile.movement === 'slowed';
  tileProperties[String(id)] = {
    smoThemeId: spec.key,
    smoThemeName: spec.name,
    smoTileId: String(index + 1),
    name: tile.name || tile.alias,
    category: tile.category || (blocked ? 'obstacle_blocking' : 'floor'),
    movement: tile.movement || 'passable',
    interaction: tile.interaction || 'none',
    blocksMovement: blocked,
    blocksVision: blocked && tile.blocksVision !== false,
    moveSpeed: blocked ? 0 : (slowed ? 0.55 : 1),
    sourceCells: [{ column: (index % columns) + 1, row: Math.floor(index / columns) + 1 }],
    sourceTile: { column: col, row },
  };

  if (!aliases[tile.alias]) aliases[tile.alias] = [];
  aliases[tile.alias].push(id);
  report.push({ id, alias: tile.alias, at: `${col},${row}`, cat: tileProperties[String(id)].category, move: tileProperties[String(id)].movement, fill: Math.round((opaque / (srcTile * srcTile)) * 100) });
});

const png = sheet.toPng();
const asset = {
  id: spec.assetId || `theme_${spec.key}`,
  name: spec.name,
  kind: 'custom',
  imageUrl: toDataUrl(png),
  source: 'map-theme',
  themeId: spec.key,
  themeName: spec.name,
  tileProperties,
  tileIdBase: TILE_ID_BASE,
  tileWidth: outTile,
  tileHeight: outTile,
  createdAt: '',
  updatedAt: new Date().toISOString(),
};

const jsonPath = resolve(`out/themes/${spec.key}.json`);
const pngPath = resolve(`out/themes/${spec.key}.png`);
await mkdir(dirname(jsonPath), { recursive: true });
await writeFile(pngPath, png);
await writeFile(jsonPath, JSON.stringify({
  key: spec.key,
  generatedAt: new Date().toISOString(),
  sourcePack: spec.sourcePack || spec.source,
  license: spec.license || '',
  aliases,
  asset,
}, null, 2), 'utf8');

console.log(`[import-tileset] "${spec.name}" 타일 ${tiles.length}장 · 시트 ${sheet.width}×${sheet.height} · ${(png.length / 1024).toFixed(1)}KB`);
if (process.argv.includes('--list')) {
  console.log('  id    별칭            원본     분류               이동      불투명');
  for (const row of report) {
    console.log(`  ${row.id}  ${row.alias.padEnd(16)} ${row.at.padEnd(8)} ${row.cat.padEnd(18)} ${row.move.padEnd(9)} ${row.fill}%`);
  }
} else {
  const blocked = report.filter((r) => r.move === 'blocked').length;
  console.log(`  손으로 고른 ${(spec.tiles || []).length}장 + 영역 수집 ${regionTiles.length}장 · 통행 ${report.length - blocked} / 차단 ${blocked}`);
  console.log('  전체 목록은 --list 로 봅니다.');
}
console.log('');
console.log(`[import-tileset] → ${jsonPath}`);
console.log(`[import-tileset] → ${pngPath}  (시트 확인용)`);
if (spec.license) console.log(`  라이선스: ${spec.license}`);
