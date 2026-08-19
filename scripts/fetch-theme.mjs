#!/usr/bin/env node
/**
 * SPUM 이 새 계정에 심어주는 기본 맵 테마를 받아서 캐시한다.
 *
 * 근거: Studio 는 부팅 시 `studio/data/server-studio-seed.json` 을 읽어
 * 로컬 데이터를 시드한다 (`StudioPersistence.loadServerStudioSeed`).
 * 이 시드는 로그인 없이 공개로 받아진다 — 안에 기본 맵 1개와
 * 기본 맵 테마("기본 맵 데이터", 타일 20장)가 통째로 들어 있다.
 *
 * 시드의 맵에 붙어 있는 테마 타일셋은 이미 **구워진 시트(data URL)** 와
 * `tileProperties` 를 함께 들고 있어서, 그대로 다른 맵에 붙일 수 있다.
 *
 * 사용: node scripts/fetch-theme.mjs
 * 결과: out/themes/spum-default.json
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { normalizeTheme, findThemeTileset, describeTheme } from '../src/spum-theme.mjs';

const SEED_URL = 'https://spum.soonsoon.ai/studio/data/server-studio-seed.json?v=spum-studio-seed-20260701-1';
const MAPS_KEY = 'sv_studio_maps_v1';

/**
 * 기본 테마의 별칭.
 *
 * ★ 이건 실측이 아니라 **타일 그림을 눈으로 보고 붙인 이름**이다.
 *   AI 분류기가 붙인 name/category 는 그림과 어긋난 것이 있다 —
 *   "wall 58/59" 는 실제로 나무이고, "wall 90" 은 돌바닥이다.
 *   그래서 분류기 이름 대신 별칭을 쓴다.
 */
const DEFAULT_ALIASES = Object.freeze({
  dirt: [2049, 2059, 2068],        // 흙바닥 / 흙+풀덤불
  water: [2050, 2062],             // 물 (movement: slowed)
  stone_wall: [2051, 2052],        // 돌담 (movement: blocked)
  grass: [2053, 2057, 2060, 2063], // 민 잔디
  tree: [2055, 2056],              // 나무 (movement: blocked)
  stone_floor: [2064],             // 회색 포장 돌바닥
  flowers: [2054, 2058, 2061, 2065, 2066, 2067], // 꽃 핀 잔디
  bush: [2059, 2068],              // 흙 위 풀덤불
});

/**
 * 분류기가 틀린 것을 바로잡는다.
 *
 * 2064("wall 90")는 그림이 **회색 포장 돌바닥**인데 obstacle_blocking 으로 분류됐다.
 * 그대로 두면 마당 바닥으로 칠한 칸이 Studio 에서 덧칠될 때 obstacle 로 뒤집힌다.
 * 근거는 시트 그림이고, 뒤집으면 통행 가능한 바닥이 된다.
 */
const CLASSIFIER_OVERRIDES = Object.freeze({
  2064: { category: 'floor', movement: 'passable', blocksMovement: false, blocksVision: false, moveSpeed: 1 },
});

console.log(`[fetch-theme] 시드 요청 ${SEED_URL.split('?')[0]}`);
const response = await fetch(SEED_URL);
if (!response.ok) {
  console.error(`[fetch-theme] 실패 HTTP ${response.status}`);
  process.exit(1);
}
const seed = await response.json();
const keys = seed?.keys && typeof seed.keys === 'object' ? seed.keys : {};
const maps = JSON.parse(keys[MAPS_KEY] || '[]');

const asset = maps.map(findThemeTileset).find(Boolean);
if (!asset) {
  console.error('[fetch-theme] 시드의 맵에서 테마 타일셋을 못 찾았습니다. SPUM 이 시드를 바꿨을 수 있습니다.');
  process.exit(1);
}

for (const [id, patch] of Object.entries(CLASSIFIER_OVERRIDES)) {
  const props = asset.tileProperties?.[id];
  if (!props) continue;
  Object.assign(props, patch);
  console.log(`[fetch-theme] 분류 교정 ${id} "${props.name}" → ${patch.category} / ${patch.movement}`);
}

const theme = normalizeTheme(asset, { aliases: DEFAULT_ALIASES });
if (!theme.imageUrl.startsWith('data:image/')) {
  console.error('[fetch-theme] 테마 시트가 data URL 이 아닙니다 — 그대로 재사용할 수 없습니다.');
  process.exit(1);
}

const sheetBytes = Math.floor((theme.imageUrl.length - theme.imageUrl.indexOf(',') - 1) * 3 / 4);
console.log(`[fetch-theme] "${theme.name}" (${theme.themeId})`);
console.log(`  타일 ${theme.tiles.length}장 · id ${theme.tileIdBase}~${theme.tileIdBase + theme.tiles.length - 1} · ${theme.tileWidth}px · 시트 ${(sheetBytes / 1024).toFixed(1)}KB`);
console.log('');
console.log('  id    별칭         이름         분류               이동');
console.log(describeTheme(theme));

const outPath = resolve('out/themes/spum-default.json');
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify({
  key: 'outdoor',
  fetchedAt: new Date().toISOString(),
  source: SEED_URL,
  aliases: DEFAULT_ALIASES,
  asset,
}, null, 2), 'utf8');
console.log('');
console.log(`[fetch-theme] → ${outPath}`);
console.log('  레이아웃 설정에서 "grass" · "stone_wall" · "water" 처럼 별칭으로 타일을 고를 수 있습니다.');
