/**
 * SPUM 맵 테마(타일셋) 읽기.
 *
 * 맵 테마는 Object 에디터에서 만든다 — 소스 시트를 그리드로 자르고, 조각마다
 * category(floor/obstacle_blocking/obstacle_slowing/item/decoration)와
 * movement(passable/blocked/slowed)를 붙인 것이다. 맵 에디터는 그 조각들을
 * 한 장의 시트로 구워(`createTileSetAssetFromMapTheme`) 타일셋으로 쓴다.
 *
 * 구워진 결과는 맵 레코드의 `tilesets[]` 에 그대로 저장된다:
 *   { id: 'theme_<themeId>', imageUrl: <data URL 시트>, tileIdBase, tileProperties }
 *   타일 id = tileIdBase + 슬롯 인덱스 (좌→우, 상→하)
 *
 * `tileProperties[id]` 에 이름·분류·이동 특성이 들어 있어서, 레이아웃 설정에서
 * 숫자 대신 이름으로 타일을 고를 수 있다.
 */

export const THEME_TILE_ID_BASE_MIN = 2049; // 1 + TILESET_ID_STRIDE
export const RULE_BRUSH_TILE_ID_BASE = 50000;

/** 맵 레코드의 tilesets[] 에서 테마 타일셋을 꺼낸다 */
export function findThemeTileset(mapRecord) {
  const list = Array.isArray(mapRecord?.tilesets) ? mapRecord.tilesets : [];
  return list.find((asset) => (
    asset?.source === 'map-theme'
    || String(asset?.id || '').startsWith('theme_')
    || Boolean(asset?.themeId)
  )) || null;
}

/**
 * 타일셋 자산 → 이 리포가 쓰는 테마 객체.
 * @returns {{ assetId, name, tileIdBase, tileWidth, tileHeight, imageUrl, tiles: Array, byName: Map, aliases: Object }}
 */
export function normalizeTheme(asset, { aliases = {} } = {}) {
  const tileIdBase = Math.max(THEME_TILE_ID_BASE_MIN, Number(asset?.tileIdBase) || THEME_TILE_ID_BASE_MIN);
  const properties = asset?.tileProperties && typeof asset.tileProperties === 'object'
    ? asset.tileProperties
    : {};

  const tiles = Object.entries(properties)
    .map(([id, props]) => ({
      id: Number(id) || 0,
      slot: (Number(id) || 0) - tileIdBase,
      name: String(props?.name || '').trim(),
      category: String(props?.category || '').trim(),
      movement: String(props?.movement || '').trim(),
      blocksMovement: props?.blocksMovement === true,
      blocksVision: props?.blocksVision === true,
      moveSpeed: Number(props?.moveSpeed ?? 1),
    }))
    .filter((tile) => tile.id > 0)
    .sort((a, b) => a.id - b.id);

  const byName = new Map();
  for (const tile of tiles) {
    if (tile.name && !byName.has(tile.name)) byName.set(tile.name, tile.id);
  }

  return {
    assetId: String(asset?.id || '').trim(),
    name: String(asset?.name || asset?.themeName || '').trim(),
    themeId: String(asset?.themeId || '').trim(),
    tileIdBase,
    tileWidth: Number(asset?.tileWidth) || 32,
    tileHeight: Number(asset?.tileHeight) || Number(asset?.tileWidth) || 32,
    imageUrl: String(asset?.imageUrl || ''),
    sheetWidth: Number(asset?.sheetWidth) || 0,
    sheetHeight: Number(asset?.sheetHeight) || 0,
    tileProperties: properties,
    tiles,
    byName,
    aliases: { ...aliases },
  };
}

/**
 * 레이아웃 설정의 타일 값 하나를 실제 타일 id 로 바꾼다.
 * 숫자면 그대로, 문자열이면 별칭 → 타일 이름 → 슬롯 번호(`#3`) 순으로 찾는다.
 * 별칭이 여러 후보를 가리키면 index 로 고른다 ("grass:2" = 잔디 후보 중 3번째).
 */
export function resolveTileRef(theme, ref, { label = 'tile' } = {}) {
  if (ref == null || ref === '') return 0;
  if (typeof ref === 'number') return Math.trunc(ref);
  const raw = String(ref).trim();
  if (/^-?\d+$/.test(raw)) return Number(raw);

  if (raw.startsWith('#')) {
    const slot = Number(raw.slice(1));
    if (Number.isInteger(slot) && slot >= 0) return theme.tileIdBase + slot;
    throw new Error(`${label}: "${raw}" — # 뒤에는 슬롯 번호(0부터)를 씁니다.`);
  }

  const [key, indexPart] = raw.split(':');
  const wanted = Math.max(0, Number(indexPart) || 0);

  const candidates = theme.aliases[key];
  if (Array.isArray(candidates) && candidates.length > 0) {
    if (wanted >= candidates.length) {
      throw new Error(`${label}: 별칭 "${key}" 의 후보는 ${candidates.length}개인데 ${wanted}번을 요청했습니다.`);
    }
    return candidates[wanted];
  }

  if (theme.byName.has(raw)) return theme.byName.get(raw);

  const known = [...Object.keys(theme.aliases), ...theme.byName.keys()].join(', ');
  throw new Error(`${label}: 타일 "${raw}" 를 테마 "${theme.name}" 에서 못 찾았습니다.\n  쓸 수 있는 이름: ${known}`);
}

/** 이 타일이 Studio 기준으로 통행을 막는가 (walkable/obstacle 자동 판정에 쓴다) */
export function tileBlocks(theme, tileId) {
  const props = theme.tileProperties?.[String(tileId)];
  if (!props) return false;
  return props.blocksMovement === true || String(props.movement || '') === 'blocked';
}

/** 맵 레코드에 붙일 tilesets[] 항목 (Studio 가 읽는 형태 그대로) */
export function themeToTilesetAsset(theme) {
  return {
    id: theme.assetId,
    name: theme.name,
    kind: 'custom',
    imageUrl: theme.imageUrl,
    sheetWidth: theme.sheetWidth || undefined,
    sheetHeight: theme.sheetHeight || undefined,
    source: 'map-theme',
    themeId: theme.themeId,
    themeName: theme.name,
    tileProperties: theme.tileProperties,
    tileIdBase: theme.tileIdBase,
    tileWidth: theme.tileWidth,
    tileHeight: theme.tileHeight,
    createdAt: '',
    updatedAt: new Date().toISOString(),
  };
}

/** 사람이 읽는 팔레트 표 */
export function describeTheme(theme) {
  const aliasOf = new Map();
  for (const [alias, ids] of Object.entries(theme.aliases)) {
    for (const id of ids) {
      if (!aliasOf.has(id)) aliasOf.set(id, alias);
    }
  }
  return theme.tiles.map((tile) => {
    const alias = aliasOf.get(tile.id) || '';
    const move = tile.blocksMovement ? '막힘' : (tile.movement === 'slowed' ? '느림' : '통행');
    return `  ${tile.id}  ${(alias || '-').padEnd(12)} ${tile.name.padEnd(12)} ${tile.category.padEnd(18)} ${move}`;
  }).join('\n');
}

// ── 다중 테마 ────────────────────────────────────────────────
// 맵은 타일 테마를 여러 개 물 수 있다 (팀 가이드 §4-8, 기본맵이 실증).
// 테마마다 TILESET_ID_STRIDE(2048) 간격으로 id 공간을 받는다:
//   2049~4096 · 4097~6144 · 6145~8192 …

export const TILESET_ID_STRIDE = 2048;

/** 테마의 타일 id 대역을 옮긴다 (tileProperties 키와 별칭 id 를 함께 이동) */
export function rebaseTheme(theme, newBase) {
  const delta = newBase - theme.tileIdBase;
  if (delta === 0) return theme;

  const tileProperties = Object.fromEntries(
    Object.entries(theme.tileProperties).map(([id, props]) => [String(Number(id) + delta), props])
  );
  const aliases = Object.fromEntries(
    Object.entries(theme.aliases).map(([key, ids]) => [key, ids.map((id) => id + delta)])
  );
  const byName = new Map(Array.from(theme.byName, ([name, id]) => [name, id + delta]));

  return {
    ...theme,
    tileIdBase: newBase,
    tileProperties,
    aliases,
    byName,
    tiles: theme.tiles.map((tile) => ({ ...tile, id: tile.id + delta })),
  };
}

/**
 * 테마 여러 개를 하나의 조회 객체로 합친다.
 *
 * 별칭은 두 형태로 등록된다:
 *   `grass`           — 앞선 테마 우선 (먼저 등록된 것이 이김)
 *   `outdoor.grass`   — 테마 키를 붙여 정확히 지정
 *
 * @param {Array<{ key: string, theme: object }>} entries
 */
export function mergeThemes(entries) {
  const themes = [];
  let base = THEME_TILE_ID_BASE_MIN;
  for (const entry of entries) {
    const rebased = rebaseTheme(entry.theme, base);
    themes.push({ key: entry.key, ...rebased });
    base += TILESET_ID_STRIDE;
    if (base >= RULE_BRUSH_TILE_ID_BASE) {
      throw new Error(`테마가 너무 많습니다 — id 대역이 룰 브러시 영역(${RULE_BRUSH_TILE_ID_BASE})에 닿습니다.`);
    }
  }

  const aliases = {};
  const byName = new Map();
  const tileProperties = {};
  for (const theme of themes) {
    for (const [key, ids] of Object.entries(theme.aliases)) {
      if (!aliases[key]) aliases[key] = ids.slice();       // 앞선 테마 우선
      aliases[`${theme.key}.${key}`] = ids.slice();        // 정확 지정
    }
    for (const [name, id] of theme.byName) {
      if (!byName.has(name)) byName.set(name, id);
      byName.set(`${theme.key}.${name}`, id);
    }
    Object.assign(tileProperties, theme.tileProperties);
  }

  const primary = themes[0];
  return {
    themes,
    name: themes.map((t) => t.name).join(' + '),
    assetId: primary?.assetId || '',
    tileIdBase: primary?.tileIdBase || THEME_TILE_ID_BASE_MIN,
    tileWidth: primary?.tileWidth || 32,
    tileHeight: primary?.tileHeight || 32,
    imageUrl: primary?.imageUrl || '',
    aliases,
    byName,
    tileProperties,
    tiles: themes.flatMap((t) => t.tiles),
  };
}

/** 합쳐진 테마 → 맵 레코드의 tilesets[] */
export function themesToTilesetAssets(merged) {
  const list = Array.isArray(merged?.themes) ? merged.themes : [merged];
  return list.map((theme) => themeToTilesetAsset(theme));
}

/** 이 타일 id 를 가진 테마를 찾는다 (미리보기 렌더러가 시트를 고를 때) */
export function themeForTileId(merged, tileId) {
  const list = Array.isArray(merged?.themes) ? merged.themes : [merged];
  return list.find((theme) => tileId >= theme.tileIdBase && tileId < theme.tileIdBase + TILESET_ID_STRIDE) || null;
}
