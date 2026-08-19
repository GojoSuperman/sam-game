#!/usr/bin/env node
/**
 * Studio 백업에서 맵 테마를 꺼내 이 리포의 테마 형식으로 만든다.
 *
 * Object 에디터에서 AI 로 생성·슬라이스·분류한 테마를 코드 쪽으로 가져오는 경로다.
 * 두 가지 방법을 순서대로 시도한다:
 *
 *   ① 맵에 붙은 타일셋 — 맵의 `tilesets[]` 에 **구워진 시트가 data URL 로** 들어 있다.
 *      (Map 섹션에서 그 테마를 타일셋으로 한 번 고르고 저장했으면 여기에 있다)
 *   ② 오브젝트의 mapTheme — 타일마다 `imageDataUrl` 이 남아 있으면 시트를 직접 굽는다.
 *      Studio 는 용량을 줄이려고 이 인라인 이미지를 지우고 `assetId` 만 남기는 경우가 있어
 *      그때는 ①이 필요하다.
 *
 * 사용: node scripts/theme-from-backup.mjs --backup <백업.json> [--key ai] [--base 4097]
 * 결과: out/themes/<key>.json
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { Canvas, decodePng, toDataUrl } from '../src/png.mjs';
import { readBackup, readKeyArray } from '../src/studio-backup.mjs';
import { MAPS_KEY } from '../src/spum-map.mjs';
import { findThemeTileset, normalizeTheme, describeTheme, rebaseTheme } from '../src/spum-theme.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const backupPath = arg('backup');
if (!backupPath) {
  console.error('사용법: node scripts/theme-from-backup.mjs --backup <Studio백업.json> [--key ai] [--base 4097]');
  process.exit(1);
}
const key = arg('key', 'ai');
// id 대역은 여기서 고정하지 않는다 — 맵 생성기의 mergeThemes 가 테마 순서대로
// 2049 · 4097 · 6145 … 로 자동 배정한다. 여기서 겹치게 잡으면 그쪽에서 다시 옮겨야 한다.
const tileIdBase = Number(arg('base', '2049')) || 2049;
const columns = Number(arg('columns', '8')) || 8;

const backup = await readBackup(resolve(backupPath));
const maps = readKeyArray(backup, MAPS_KEY);
const smos = readKeyArray(backup, 'sv_studio_smo_v1');

console.log(`[theme-from-backup] 맵 ${maps.length}개 · 오브젝트 ${smos.length}개`);

// ── ① 맵에 붙은 타일셋 (구워진 시트) ────────────────────────
const baked = maps
  .map((map) => ({ map, asset: findThemeTileset(map) }))
  .filter((entry) => entry.asset && String(entry.asset.imageUrl || '').startsWith('data:image/'));

let asset = null;
let tiles = [];
if (baked.length > 0) {
  const wanted = arg('theme');
  const picked = wanted
    ? baked.find((e) => e.asset.themeId === wanted || e.asset.id === wanted || e.asset.name === wanted)
    : baked[baked.length - 1];
  if (!picked) {
    console.error(`--theme "${wanted}" 를 못 찾았습니다. 있는 것: ${baked.map((e) => e.asset.themeId).join(', ')}`);
    process.exit(1);
  }
  // 구워진 시트를 그대로 쓰되, tileProperties 키(=타일 id)를 요청한 대역으로 옮긴다
  const source = normalizeTheme({ ...picked.asset, tiles: [] }, { aliases: {} });
  const moved = rebaseTheme(source, tileIdBase);
  asset = {
    ...picked.asset,
    tiles: [],
    tileIdBase: moved.tileIdBase,
    tileProperties: moved.tileProperties,
  };
  console.log(`  ① 맵 "${picked.map.name}" 의 타일셋 "${asset.name}" 에서 가져옵니다 (구워진 시트 그대로)`);
  if (source.tileIdBase !== tileIdBase) {
    console.log(`     id 대역 ${source.tileIdBase} → ${tileIdBase} 로 옮겼습니다`);
  }
} else {
  // ── ② 오브젝트 mapTheme 에서 시트를 직접 굽는다 ──────────
  const candidates = smos
    .map((smo) => smo?.mapTheme)
    .filter((theme) => Array.isArray(theme?.tiles) && theme.tiles.length > 0);
  const theme = candidates.find((t) => t.tiles.some((tile) => String(tile.imageDataUrl || '').startsWith('data:image/')));
  if (!theme) {
    console.error('');
    console.error('테마를 못 찾았습니다. 둘 중 하나가 필요합니다:');
    console.error('  · Map 섹션에서 그 테마를 맵의 타일셋으로 한 번 고르고 저장한 뒤 백업을 내보내기 (권장)');
    console.error('  · 또는 오브젝트의 테마 타일에 imageDataUrl 이 남아 있어야 합니다');
    process.exit(1);
  }
  const usable = theme.tiles.filter((tile) => String(tile.imageDataUrl || '').startsWith('data:image/'));
  console.log(`  ② 오브젝트 테마 "${theme.name}" 에서 시트를 굽습니다 (타일 ${usable.length}/${theme.tiles.length}장에 이미지가 남아 있음)`);

  const tileSize = Math.max(1, Number(theme.tileSize) || 32);
  const rows = Math.ceil(usable.length / columns);
  const sheet = new Canvas(columns * tileSize, rows * tileSize);
  const tileProperties = {};
  usable.forEach((tile, index) => {
    const img = decodePng(Buffer.from(String(tile.imageDataUrl).split(',')[1], 'base64'));
    const ox = (index % columns) * tileSize;
    const oy = Math.floor(index / columns) * tileSize;
    for (let y = 0; y < Math.min(tileSize, img.height); y += 1) {
      for (let x = 0; x < Math.min(tileSize, img.width); x += 1) {
        const i = (y * img.width + x) * 4;
        if (img.data[i + 3] === 0) continue;
        sheet.set(ox + x, oy + y, [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]);
      }
    }
    const id = tileIdBase + index;
    const blocked = tile.movement === 'blocked' || tile.properties?.blocksMovement === true;
    tileProperties[String(id)] = {
      smoThemeId: theme.id || key,
      smoThemeName: theme.name || key,
      smoTileId: String(index + 1),
      name: tile.name || `tile ${index + 1}`,
      category: tile.category || 'floor',
      movement: tile.movement || 'passable',
      interaction: tile.interaction || 'none',
      blocksMovement: blocked,
      blocksVision: blocked,
      moveSpeed: blocked ? 0 : (tile.movement === 'slowed' ? 0.55 : 1),
      sourceCells: [{ column: (index % columns) + 1, row: Math.floor(index / columns) + 1 }],
    };
  });
  asset = {
    id: `theme_${key}`,
    name: theme.name || key,
    kind: 'custom',
    imageUrl: toDataUrl(sheet.toPng()),
    source: 'map-theme',
    themeId: theme.id || key,
    themeName: theme.name || key,
    tileProperties,
    tileIdBase,
    tileWidth: tileSize,
    tileHeight: tileSize,
    createdAt: '',
    updatedAt: new Date().toISOString(),
  };
}

// 별칭 — 생성된 타일 이름("floor 01")은 쓸모가 적으니 분류별로 번호를 붙인다
const normalized = normalizeTheme(asset, { aliases: {} });
const aliases = {};
const counters = {};
for (const tile of normalized.tiles) {
  const group = tile.movement === 'blocked' ? 'block'
    : (tile.movement === 'slowed' ? 'slow'
      : (tile.category === 'decoration' ? 'deco' : 'floor'));
  const bucket = `ai_${group}`;
  if (!aliases[bucket]) aliases[bucket] = [];
  aliases[bucket].push(tile.id);
  counters[group] = (counters[group] || 0) + 1;
}

const outPath = resolve(`out/themes/${key}.json`);
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify({
  key,
  generatedAt: new Date().toISOString(),
  fromBackup: backupPath,
  aliases,
  asset,
}, null, 2), 'utf8');

const sheetKb = ((asset.imageUrl.length - asset.imageUrl.indexOf(',') - 1) * 3 / 4 / 1024).toFixed(1);
console.log(`[theme-from-backup] "${asset.name}" 타일 ${normalized.tiles.length}장 · id ${tileIdBase}~ · 시트 ${sheetKb}KB`);
console.log(`  분류: ${Object.entries(counters).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
console.log('');
console.log('  id    별칭         이름         분류               이동');
console.log(describeTheme({ ...normalized, aliases }));
console.log('');
console.log(`[theme-from-backup] → ${outPath}`);
console.log('');
console.log('섞어 쓰기:');
console.log(`  pnpm map --config bake/med-villa-1f.json --theme out/themes/med.json --theme out/themes/${key}.json ...`);
console.log('  → Kenney 팩은 2049~, AI 테마는 4097~ 대역을 받습니다. 별칭은 "ai.ai_floor:0" 처럼 지정합니다.');
