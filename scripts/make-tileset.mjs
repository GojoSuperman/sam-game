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
 * 사용: node scripts/make-tileset.mjs [--set interior|ship]
 * 결과: out/themes/<세트>.json · out/themes/<세트>.png
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { Canvas, toDataUrl } from '../src/png.mjs';
import { buildInteriorTiles } from '../src/tile-art.mjs';
import { buildShipTiles } from '../src/tile-art-ship.mjs';

/** 타일 세트 정의 — 새 세트를 추가하려면 여기에 한 줄 */
const SETS = {
  interior: {
    build: buildInteriorTiles, key: 'indoor', slug: 'proto-interior',
    assetId: 'theme_proto_interior', themeId: 'proto_interior', label: '프로토 실내',
    note: '코드로 그린 프로토타입 타일. 진짜 타일이 생기면 시트만 교체한다.',
  },
  ship: {
    build: buildShipTiles, key: 'ship', slug: 'ship-interior',
    assetId: 'theme_ship_interior', themeId: 'ship_interior', label: '우주선 실내',
    note: '코드로 그린 우주선 실내 타일 — 갑판·격벽·설비. 기하학적이라 절차적 생성이 잘 맞는다.',
  },
};

const args = process.argv.slice(2);
const setName = (() => { const i = args.indexOf('--set'); return i > -1 ? args[i + 1] : 'interior'; })();
const SET = SETS[setName];
if (!SET) { console.error(`알 수 없는 세트: ${setName}. 가능: ${Object.keys(SETS).join(', ')}`); process.exit(1); }

const TILE = 32;
const COLUMNS = 5;
const ASSET_ID = SET.assetId;
const TILE_ID_BASE = 2049; // 1 + TILESET_ID_STRIDE — 두 번째 타일셋의 첫 id

const tiles = SET.build();
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
    smoThemeId: SET.themeId,
    smoThemeName: SET.label,
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
  name: SET.label,
  kind: 'custom',
  imageUrl: toDataUrl(png),
  source: 'map-theme',
  themeId: SET.themeId,
  themeName: SET.label,
  tileProperties,
  tileIdBase: TILE_ID_BASE,
  tileWidth: TILE,
  tileHeight: TILE,
  createdAt: '',
  updatedAt: new Date().toISOString(),
};

const jsonPath = resolve(`out/themes/${SET.slug}.json`);
const pngPath = resolve(`out/themes/${SET.slug}.png`);
await mkdir(dirname(jsonPath), { recursive: true });
await writeFile(pngPath, png);
await writeFile(jsonPath, JSON.stringify({
  key: SET.key,
  generatedAt: new Date().toISOString(),
  note: SET.note,
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
