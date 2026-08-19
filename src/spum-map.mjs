/**
 * SPUM Studio 맵 레코드 스키마 — 정규화 · 검증.
 *
 * 근거(실측, 2026-08-19): Studio 소스를 그대로 읽어 옮겼다.
 *   packages/spum-map/store/MapStore.js      맵 레코드 _normalize()
 *   packages/spum-map/editor/MapDraftModel.js 레이어 이름/타입/정렬 규칙
 *   packages/spum-map/editor/MapTilesetModel.js 타일 id 체계
 *
 * 맵은 localStorage 키 `sv_studio_maps_v1` 에 배열로 들어간다.
 * Studio 가 읽을 때 _normalize() 를 한 번 더 돌리므로, 여기서 규칙을 어기면
 * 조용히 기본값으로 덮여 사라진다. 그래서 저장 전에 여기서 먼저 잡는다.
 */

export const MAPS_KEY = 'sv_studio_maps_v1';

/** 기본 내장 타일셋. 16×16 = 타일 256장, 32px, tileIdBase 1 */
export const DEFAULT_TILESET_ASSET_ID = 'builtin_tp_tile01';
export const BUILTIN_TILESET_URL = 'https://spum.soonsoon.ai/assets/TP_Tile01.png';
export const BUILTIN_TILE_COLUMNS = 16;
export const BUILTIN_TILE_COUNT = 256;

/** 타일셋 하나가 차지하는 id 폭. 두 번째 타일셋은 base 2049 부터 */
export const TILESET_ID_STRIDE = 2048;
export const RULE_BRUSH_TILE_ID_BASE = 50000;

export const DEFAULT_MAP_WIDTH = 40;
export const DEFAULT_MAP_HEIGHT = 30;
export const DEFAULT_TILE_SIZE = 32;

export const LAYER_TYPES = Object.freeze({
  BACK: 'back',
  FRONT: 'front',
  WALKABLE: 'walkable',
  OBSTACLE: 'obstacle',
});

/** 이 네 개는 Studio 가 없으면 자동으로 만들어 붙인다. 처음부터 넣는다. */
export const REQUIRED_LAYERS = Object.freeze([
  { name: 'back_1', type: LAYER_TYPES.BACK },
  { name: 'front_1', type: LAYER_TYPES.FRONT },
  { name: 'walkable', type: LAYER_TYPES.WALKABLE },
  { name: 'obstacle', type: LAYER_TYPES.OBSTACLE },
]);

export const NAVIGATION_LAYER_NAMES = Object.freeze(['walkable', 'obstacle']);

/** walkable/obstacle 레이어는 타일 id 가 아니라 1/0 플래그다 (MapWorkspace._paintAtTile) */
export const NAV_ON = 1;
export const NAV_OFF = 0;

export function isNavigationLayer(name) {
  return NAVIGATION_LAYER_NAMES.includes(String(name || '').trim());
}

/** MapStore._id() 와 같은 형식 */
export function newMapId() {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `MAP_${t}_${r}`;
}

export function createGrid(width, height, fill = 0) {
  return new Array(width * height).fill(fill);
}

export function idx(width, col, row) {
  return row * width + col;
}

function inferLayerType(name = '') {
  const n = String(name || '').trim();
  if (!n) return LAYER_TYPES.BACK;
  if (n === 'ground' || n === 'detail' || n.startsWith('back_')) return LAYER_TYPES.BACK;
  if (n === 'walkable') return LAYER_TYPES.WALKABLE;
  if (n === 'obstacle' || n === 'collision') return LAYER_TYPES.OBSTACLE;
  return LAYER_TYPES.FRONT;
}

/** MapDraftModel.groupNormalizedLayers() — back → front → walkable → obstacle */
function orderLayers(layers) {
  const back = [];
  const front = [];
  let walkable = null;
  let obstacle = null;
  for (const layer of layers) {
    if (layer.type === LAYER_TYPES.WALKABLE) walkable = layer;
    else if (layer.type === LAYER_TYPES.OBSTACLE) obstacle = layer;
    else if (layer.type === LAYER_TYPES.BACK) back.push(layer);
    else front.push(layer);
  }
  return [...back, ...front, ...(walkable ? [walkable] : []), ...(obstacle ? [obstacle] : [])];
}

function normalizeLayer(raw, width, height) {
  const name = String(raw?.name || '').trim();
  const type = Object.values(LAYER_TYPES).includes(String(raw?.type || '').trim())
    ? String(raw.type).trim()
    : inferLayerType(name);
  const size = width * height;
  const data = new Array(size).fill(0);
  const source = Array.isArray(raw?.data) ? raw.data : null;
  if (source) {
    for (let i = 0; i < Math.min(size, source.length); i += 1) data[i] = Number(source[i]) || 0;
  } else if (Array.isArray(raw?.rows)) {
    for (let row = 0; row < Math.min(height, raw.rows.length); row += 1) {
      const cells = Array.isArray(raw.rows[row]) ? raw.rows[row] : [];
      for (let col = 0; col < Math.min(width, cells.length); col += 1) {
        data[row * width + col] = Number(cells[col]) || 0;
      }
    }
  }
  return { name, type, label: String(raw?.label || '').trim(), data };
}

/** MapStore._normalize() 와 같은 결과를 낸다 */
export function normalizeMapRecord(raw = {}) {
  const now = new Date().toISOString();
  const width = Math.max(1, Number(raw.width) || DEFAULT_MAP_WIDTH);
  const height = Math.max(1, Number(raw.height) || DEFAULT_MAP_HEIGHT);

  const seen = new Set();
  const layers = [];
  for (const rawLayer of Array.isArray(raw.layers) ? raw.layers : []) {
    const layer = normalizeLayer(rawLayer, width, height);
    if (!layer.name || seen.has(layer.name)) continue;
    seen.add(layer.name);
    layers.push(layer);
  }
  for (const blueprint of REQUIRED_LAYERS) {
    if (seen.has(blueprint.name)) continue;
    seen.add(blueprint.name);
    layers.push({ name: blueprint.name, type: blueprint.type, label: '', data: createGrid(width, height) });
  }

  return {
    id: String(raw.id || newMapId()).trim(),
    name: String(raw.name || '').trim() || 'Unnamed Map',
    description: String(raw.description || '').trim(),
    version: Number(raw.version) || 1,
    width,
    height,
    tileSize: Number(raw.tileSize) || DEFAULT_TILE_SIZE,
    tileSetAssetId: String(raw.tileSetAssetId || DEFAULT_TILESET_ASSET_ID).trim(),
    mapThemeId: String(raw.mapThemeId || '').trim(),
    savedAt: String(raw.savedAt || now),
    layers: orderLayers(layers),
    objects: Array.isArray(raw.objects) ? raw.objects : [],
    ruleTiles: raw.ruleTiles && typeof raw.ruleTiles === 'object' ? raw.ruleTiles : {},
    tilesets: Array.isArray(raw.tilesets) ? raw.tilesets : [],
    spawnPoints: Array.isArray(raw.spawnPoints) ? raw.spawnPoints : [],
    meta: {
      createdAt: raw.meta?.createdAt || now,
      updatedAt: raw.meta?.updatedAt || now,
      tags: Array.isArray(raw.meta?.tags) ? raw.meta.tags : [],
    },
  };
}

/**
 * Studio 에 넣기 전에 확인한다. errors 가 있으면 넣어도 의도대로 안 보인다.
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateMapRecord(record) {
  const errors = [];
  const warnings = [];
  const size = record.width * record.height;

  if (record.width < 1 || record.height < 1) errors.push('width/height 는 1 이상이어야 합니다.');
  if (![16, 32, 48, 64].includes(record.tileSize)) {
    warnings.push(`tileSize ${record.tileSize} 는 흔치 않은 값입니다 (기본 32).`);
  }

  for (const blueprint of REQUIRED_LAYERS) {
    if (!record.layers.some((l) => l.name === blueprint.name)) {
      errors.push(`필수 레이어 누락: ${blueprint.name}`);
    }
  }

  const builtin = record.tileSetAssetId === DEFAULT_TILESET_ASSET_ID;
  for (const layer of record.layers) {
    if (layer.data.length !== size) {
      errors.push(`레이어 ${layer.name}: data 길이 ${layer.data.length} ≠ ${size} (width×height)`);
    }
    if (isNavigationLayer(layer.name)) {
      const bad = layer.data.filter((v) => v !== NAV_OFF && v !== NAV_ON).length;
      if (bad > 0) errors.push(`레이어 ${layer.name}: 0/1 이외의 값 ${bad}칸 (내비 레이어는 플래그입니다)`);
      continue;
    }
    if (!builtin) continue;
    const out = layer.data.filter((v) => v !== 0 && (v < 1 || v > BUILTIN_TILE_COUNT));
    if (out.length > 0) {
      warnings.push(`레이어 ${layer.name}: 내장 타일셋 범위(1~${BUILTIN_TILE_COUNT}) 밖 타일 id ${out.length}칸 — 빈 칸으로 보입니다.`);
    }
  }

  const walkable = record.layers.find((l) => l.name === 'walkable');
  const obstacle = record.layers.find((l) => l.name === 'obstacle');
  if (walkable && obstacle) {
    let both = 0;
    for (let i = 0; i < size; i += 1) if (walkable.data[i] === NAV_ON && obstacle.data[i] === NAV_ON) both += 1;
    if (both > 0) warnings.push(`walkable 과 obstacle 이 동시에 켜진 칸 ${both}개 — 런타임 판정이 모호해집니다.`);
    if (!walkable.data.includes(NAV_ON)) errors.push('walkable 이 한 칸도 없습니다. 캐릭터가 설 자리가 없습니다.');
  }

  for (const [i, point] of record.spawnPoints.entries()) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      errors.push(`spawnPoints[${i}]: x/y 가 정수가 아닙니다.`);
      continue;
    }
    if (x < 0 || y < 0 || x >= record.width || y >= record.height) {
      errors.push(`spawnPoints[${i}] (${x},${y}): 맵 밖입니다.`);
      continue;
    }
    if (walkable && walkable.data[idx(record.width, x, y)] !== NAV_ON) {
      errors.push(`spawnPoints[${i}] "${point.label || ''}" (${x},${y}): walkable 이 아닌 칸입니다.`);
    }
  }

  for (const [i, object] of record.objects.entries()) {
    const rect = object?.rect;
    if (!rect || [rect.col, rect.row, rect.width, rect.height].some((v) => !Number.isFinite(Number(v)))) {
      errors.push(`objects[${i}] "${object?.name || ''}": rect { col, row, width, height } 가 필요합니다.`);
      continue;
    }
    if (rect.col < 0 || rect.row < 0
      || rect.col + rect.width > record.width || rect.row + rect.height > record.height) {
      warnings.push(`objects[${i}] "${object.name}": rect 가 맵 밖으로 나갑니다.`);
    }
  }

  return { errors, warnings };
}

/** walkable 을 4방향으로 flood fill. 문 없는 방을 잡는 용도 */
export function reachableFrom(record, startCol, startRow) {
  const { width, height } = record;
  const walkable = record.layers.find((l) => l.name === 'walkable');
  const seen = new Uint8Array(width * height);
  if (!walkable) return seen;
  const start = idx(width, startCol, startRow);
  if (walkable.data[start] !== NAV_ON) return seen;
  const queue = [start];
  seen[start] = 1;
  while (queue.length > 0) {
    const cur = queue.pop();
    const col = cur % width;
    const row = (cur - col) / width;
    const neighbours = [[col + 1, row], [col - 1, row], [col, row + 1], [col, row - 1]];
    for (const [nc, nr] of neighbours) {
      if (nc < 0 || nr < 0 || nc >= width || nr >= height) continue;
      const next = idx(width, nc, nr);
      if (seen[next] || walkable.data[next] !== NAV_ON) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return seen;
}
