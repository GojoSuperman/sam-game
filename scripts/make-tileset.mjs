#!/usr/bin/env node
/**
 * 실내 타일 시트를 코드로 만들어 SPUM 맵 테마 형식으로 저장한다.
 *
 * SPUM Studio 를 거치지 않는다. 맵 레코드의 `tilesets[]` 는 구워진 시트를
 * data URL 로 들고 있어도 되고(`_stripBakedTilesetSheet` 는 `tiles[]` 가
 * 비면 imageUrl 을 지우지 않는다), 실제로 SPUM 기본맵이 그 구조다.
 * 그래서 Object 에디터의 슬라이스·분류 없이 타일셋을 만들 수 있다.
 *
 * ★ 그림은 프로토타입이다. 파이프라인(생성 → 불러오기 → Studio 표시)을
 *   검증하려고 만든 것이고, 진짜 타일이 생기면 시트만 갈아끼운다.
 *
 * 사용: node scripts/make-tileset.mjs
 * 결과: out/themes/proto-interior.json · out/themes/proto-interior.png
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { Canvas, toDataUrl } from '../src/png.mjs';
import { buildInteriorTiles } from '../src/tile-art.mjs';

const TILE = 32;
const COLUMNS = 5;
const ASSET_ID = 'theme_proto_interior';
const TILE_ID_BASE = 2049; // 1 + TILESET_ID_STRIDE — 두 번째 타일셋의 첫 id

const tiles = buildInteriorTiles();
const rows = Math.ceil(tiles.length / COLUMNS);

const sheet = new Canvas(COLUMNS * TILE, rows * TILE);
tiles.forEach((tile, index) => {
  sheet.blit(tile.canvas, (index % COLUMNS) * TILE, Math.floor(index / COLUMNS) * TILE);
});
const png = sheet.toPng();

// Studio 가 읽는 tileProperties 형태 그대로 (ObjectPage._createTileProperties 참고)
const tileProperties = {};
const aliases = {};
tiles.forEach((tile, index) => {
  const id = TILE_ID_BASE + index;
  const blocked = tile.movement === 'blocked';
  tileProperties[String(id)] = {
    smoThemeId: 'proto_interior',
    smoThemeName: '프로토 실내',
    smoTileId: String(index + 1),
    name: tile.name,
    category: tile.category,
    movement: tile.movement,
    interaction: 'none',
    blocksMovement: blocked,
    blocksVision: blocked,
    moveSpeed: blocked ? 0 : (tile.movement === 'slowed' ? 0.55 : 1),
    sourceCells: [{ column: (index % COLUMNS) + 1, row: Math.floor(index / COLUMNS) + 1 }],
  };
  const [key, order] = String(tile.alias).split(':');
  if (!aliases[key]) aliases[key] = [];
  aliases[key][Number(order) || 0] = id;
});

const asset = {
  id: ASSET_ID,
  name: '프로토 실내',
  kind: 'custom',
  imageUrl: toDataUrl(png),
  source: 'map-theme',
  themeId: 'proto_interior',
  themeName: '프로토 실내',
  tileProperties,
  tileIdBase: TILE_ID_BASE,
  tileWidth: TILE,
  tileHeight: TILE,
  createdAt: '',
  updatedAt: new Date().toISOString(),
};

const jsonPath = resolve('out/themes/proto-interior.json');
const pngPath = resolve('out/themes/proto-interior.png');
await mkdir(dirname(jsonPath), { recursive: true });
await writeFile(pngPath, png);
await writeFile(jsonPath, JSON.stringify({
  key: 'indoor',
  generatedAt: new Date().toISOString(),
  note: '코드로 그린 프로토타입 타일. 진짜 타일이 생기면 시트만 교체한다.',
  aliases,
  asset,
}, null, 2), 'utf8');

console.log(`[make-tileset] 타일 ${tiles.length}장 · 시트 ${sheet.width}×${sheet.height} · ${(png.length / 1024).toFixed(1)}KB`);
console.log('  id    별칭            이름           분류               이동');
tiles.forEach((tile, index) => {
  const id = TILE_ID_BASE + index;
  console.log(`  ${id}  ${tile.alias.padEnd(14)} ${tile.name.padEnd(14)} ${tile.category.padEnd(18)} ${tile.movement}`);
});
console.log('');
console.log(`[make-tileset] → ${jsonPath}`);
console.log(`[make-tileset] → ${pngPath}  (시트 확인용)`);
