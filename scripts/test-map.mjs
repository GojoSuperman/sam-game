#!/usr/bin/env node
/**
 * 맵 생성기 자체 검사 (키·네트워크 불필요).
 *
 * Studio 는 규칙을 어긴 맵을 조용히 기본값으로 덮는다. 그래서 "Studio 가
 * 읽어줄 형태인가" 를 여기서 먼저 확인한다.
 */
import { readFile } from 'node:fs/promises';
import { normalizeTheme } from '../src/spum-theme.mjs';
import { buildMapFromLayout, renderAscii } from '../src/map-builder.mjs';
import {
  validateMapRecord, normalizeMapRecord, reachableFrom, idx,
  REQUIRED_LAYERS, NAV_ON,
} from '../src/spum-map.mjs';

let failed = 0;
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

// 예시 레이아웃은 테마 타일을 이름으로 참조한다. 캐시가 없으면 그 부분은 건너뛴다
// (`pnpm fetch-theme` 이 out/ 에 받아둔다 — out/ 은 커밋 대상이 아니다).
let theme = null;
try {
  const raw = JSON.parse(await readFile('out/themes/spum-default.json', 'utf8'));
  theme = normalizeTheme(raw.asset || raw, { aliases: raw.aliases || {} });
} catch {
  theme = null;
}

if (!theme) {
  console.log('[test-map] 테마 캐시 없음 — 예시 레이아웃 검사는 건너뜁니다 (`pnpm fetch-theme` 후 다시)');
} else {
console.log('[test-map] 예시 레이아웃');
const config = JSON.parse(await readFile('bake/example-map.json', 'utf8'));
const { record } = buildMapFromLayout(config, { theme });
const { errors, warnings } = validateMapRecord(record);

check('검증 오류 0건', errors.length === 0, errors.join(' / '));
check('경고 0건', warnings.length === 0, warnings.join(' / '));
check('필수 레이어 4종 존재',
  REQUIRED_LAYERS.every((b) => record.layers.some((l) => l.name === b.name)));
check('레이어 순서 = back… → front… → walkable → obstacle',
  record.layers.map((l) => l.type).join(',') === 'back,back,front,walkable,obstacle',
  record.layers.map((l) => l.name).join(','));
check('모든 레이어 data 길이 = width×height',
  record.layers.every((l) => l.data.length === record.width * record.height));
check('내비 레이어는 0/1 만',
  ['walkable', 'obstacle'].every((name) => record.layers.find((l) => l.name === name)
    .data.every((v) => v === 0 || v === 1)));
check('모든 타일 id 가 테마 범위 안',
  record.layers.filter((l) => !['walkable', 'obstacle'].includes(l.name))
    .every((l) => l.data.every((v) => v === 0 || (v >= theme.tileIdBase && v < theme.tileIdBase + theme.tiles.length))));
check('테마 타일셋이 맵에 붙어 있다',
  record.tilesets.length === 1 && record.tilesets[0].id === theme.assetId
    && String(record.tilesets[0].imageUrl || '').startsWith('data:image/'),
  JSON.stringify(record.tilesets.map((t) => t.id)));
check('tileSetAssetId 가 테마를 가리킨다', record.tileSetAssetId === theme.assetId, record.tileSetAssetId);
check('지면 변형이 실제로 섞였다',
  new Set(record.layers.find((l) => l.name === 'back_1').data).size > 3);
check('방 6개가 오브젝트로 기록됨',
  config.rooms.every((room) => record.objects.some((o) => o.name === room.name)),
  record.objects.map((o) => o.name).join(','));
check('스폰이 방 수 이상', record.spawnPoints.length >= config.rooms.length);
check('모든 스폰이 walkable 위',
  record.spawnPoints.every((p) => record.layers.find((l) => l.name === 'walkable')
    .data[idx(record.width, p.x, p.y)] === NAV_ON));

const seen = reachableFrom(record, record.spawnPoints[0].x, record.spawnPoints[0].y);
check('모든 스폰이 첫 스폰에서 도달 가능',
  record.spawnPoints.every((p) => seen[idx(record.width, p.x, p.y)] === 1),
  record.spawnPoints.filter((p) => !seen[idx(record.width, p.x, p.y)]).map((p) => p.label).join(','));

}

console.log('[test-map] 프로토 타일셋 생성기');
{
  const { Canvas, encodePng } = await import('../src/png.mjs');
  const { buildInteriorTiles } = await import('../src/tile-art.mjs');
  const tiles = buildInteriorTiles();
  check('타일이 10장 이상', tiles.length >= 10, String(tiles.length));
  check('별칭이 전부 있다', tiles.every((t) => t.alias));
  check('바닥·벽·문이 다 있다',
    ['wood_floor', 'wall', 'door'].every((a) => tiles.some((t) => t.alias.split(':')[0] === a)));
  check('막히는 타일은 obstacle_blocking',
    tiles.every((t) => (t.movement === 'blocked') === (t.category === 'obstacle_blocking')));
  const png = tiles[0].canvas.toPng();
  check('PNG 시그니처', png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
  check('PNG 헤더의 크기가 32×32',
    png.readUInt32BE(16) === 32 && png.readUInt32BE(20) === 32);
  const sheet = new Canvas(64, 32);
  sheet.blit(tiles[0].canvas, 0, 0);
  sheet.blit(tiles[1].canvas, 32, 0);
  check('blit 이 두 타일을 붙인다', sheet.toPng().readUInt32BE(16) === 64);
  check('encodePng 가 빈 이미지도 처리', encodePng(1, 1, new Uint8Array(4)).length > 8);
}

console.log('[test-map] 회귀 — 정규화는 멱등이어야 한다');
const sample = buildMapFromLayout({
  width: 10, height: 8, tiles: { ground: 5, floor: 7, wall: 47 },
  rooms: [{ id: 'a', name: 'A', rect: [1, 1, 6, 5], doors: [{ side: 'south', at: 3 }] }],
}).record;
const again = normalizeMapRecord(sample);
check('normalize(normalize(x)) === normalize(x)',
  JSON.stringify({ ...again, savedAt: '', meta: {} }) === JSON.stringify({ ...sample, savedAt: '', meta: {} }));

console.log('[test-map] 회귀 — 문이 없으면 연결 실패를 잡아내야 한다');
const sealed = buildMapFromLayout({
  width: 12, height: 8, tiles: { ground: 5, floor: 7, wall: 47 },
  rooms: [
    { id: 'a', name: 'A', rect: [0, 0, 5, 5] },
    { id: 'b', name: 'B', rect: [6, 0, 5, 5] },
  ],
}).record;
const sealedSeen = reachableFrom(sealed, sealed.spawnPoints[0].x, sealed.spawnPoints[0].y);
check('문 없는 두 방은 서로 도달 불가로 나온다',
  sealedSeen[idx(sealed.width, sealed.spawnPoints[1].x, sealed.spawnPoints[1].y)] === 0);

console.log('[test-map] 회귀 — walkable 이 없으면 오류');
const empty = buildMapFromLayout({ width: 8, height: 8, tiles: { ground: 5 } }).record;
check('빈 맵은 검증 오류를 낸다', validateMapRecord(empty).errors.length > 0);

check('ASCII 미리보기가 height 줄', renderAscii(sealed).split('\n').length === sealed.height);

console.log(failed === 0 ? '[test-map] 전부 통과' : `[test-map] 실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);
