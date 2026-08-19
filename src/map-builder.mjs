/**
 * 레이아웃 설정(JSON) → SPUM Studio 맵 레코드.
 *
 * 방·복도·문을 타일 단위 사각형으로 적고, 여기서 바닥/벽/walkable/obstacle 을
 * 만든다. 손으로 40×30 = 1,200칸을 찍는 대신 구조만 적는 것이 목적이다.
 *
 * 그리는 순서가 곧 우선순위다 (뒤가 앞을 덮는다):
 *   지면 → 방 바닥/벽 → 복도 → 문 → 소품
 * 복도가 방 벽을 지나가면 그 칸은 자동으로 뚫린다. 문을 따로 안 적어도 된다.
 *
 * 레이어 배치 — back 은 캐릭터 아래, front 는 캐릭터 위에 그려진다:
 *   back_1  지면·바닥
 *   back_2  벽        (캐릭터가 벽에 가리지 않도록 아래에 둔다)
 *   front_1 소품      (나무·통처럼 키 큰 것은 위에 두는 편이 자연스럽다)
 */
import {
  LAYER_TYPES,
  NAV_ON,
  NAV_OFF,
  createGrid,
  idx,
  normalizeMapRecord,
} from './spum-map.mjs';
import { resolveTileRef, themesToTilesetAssets } from './spum-theme.mjs';

function rectOf(raw, label) {
  const source = Array.isArray(raw)
    ? { col: raw[0], row: raw[1], width: raw[2], height: raw[3] }
    : (raw || {});
  const rect = {
    col: Math.trunc(Number(source.col) || 0),
    row: Math.trunc(Number(source.row) || 0),
    width: Math.trunc(Number(source.width) || 0),
    height: Math.trunc(Number(source.height) || 0),
  };
  if (rect.width < 1 || rect.height < 1) {
    throw new Error(`${label}: rect 의 width/height 가 1 이상이어야 합니다 (받은 값 ${JSON.stringify(raw)})`);
  }
  return rect;
}

/** 좌표로 결정되는 0~1 값. 난수가 아니라 좌표의 함수라 다시 돌려도 같은 그림이 나온다 */
function hash01(col, row, seed = 0) {
  let h = Math.imul(col + 1, 0x9e3779b1) ^ Math.imul(row + 1, 0x85ebca6b) ^ Math.imul(seed + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function objectId(seed) {
  return `obj_${Date.now().toString(36)}_${String(seed).padStart(3, '0')}`;
}

export function buildMapFromLayout(config = {}, { theme = null } = {}) {
  const width = Math.max(1, Math.trunc(Number(config.width) || 40));
  const height = Math.max(1, Math.trunc(Number(config.height) || 30));

  // 타일 값은 숫자(원시 id) 또는 문자열(테마 별칭/이름)이다.
  function tileId(ref, label) {
    if (ref == null || ref === '') return 0;
    if (Array.isArray(ref)) return tileId(ref[0], label);
    if (typeof ref === 'number') return Math.trunc(ref);
    if (!theme) {
      throw new Error(`${label}: "${ref}" 는 테마 타일 이름인데 테마가 없습니다. --theme 로 테마를 주거나 숫자 id 를 쓰세요.`);
    }
    return resolveTileRef(theme, ref, { label });
  }

  // 같은 타일을 넓게 깔면 가장자리 처리 때문에 격자가 보인다. 배열을 주면
  // 좌표 해시로 섞는다 — 난수가 아니라 좌표의 함수라, 다시 돌려도 같은 그림이 나온다.
  function tilePicker(ref, label) {
    const list = (Array.isArray(ref) ? ref : [ref])
      .filter((entry) => entry != null && entry !== '')
      .map((entry) => tileId(entry, label));
    if (list.length === 0) return () => 0;
    if (list.length === 1) return () => list[0];
    return (col, row) => list[Math.min(list.length - 1, Math.floor(hash01(col, row, 17) * list.length))];
  }

  const tiles = config.tiles || {};
  const pickGround = tilePicker(tiles.ground, 'tiles.ground');
  const groundTile = tileId(tiles.ground, 'tiles.ground');
  const defaultFloorRef = tiles.floor ?? tiles.ground;
  const defaultWallRef = tiles.wall;
  // 이 타일셋의 벽은 톱다운 오토타일이 아니라 정면 파사드용이다.
  // 북쪽 한 줄에 어두운 캡을 얹으면 벽에 두께가 생긴다.
  const defaultWallTopRef = tiles.wallTop ?? null;
  const groundWalkable = config.groundWalkable === true;

  const back1 = createGrid(width, height, 0);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) back1[row * width + col] = pickGround(col, row);
  }
  const back2 = createGrid(width, height, 0);
  const front1 = createGrid(width, height, 0);
  const walkable = createGrid(width, height, groundWalkable && groundTile > 0 ? NAV_ON : NAV_OFF);
  const obstacle = createGrid(width, height, NAV_OFF);

  const notes = [];
  const painted = new Map(); // "col,row" -> 그 칸을 차지한 영역 이름 (겹침 감지)

  const inBounds = (col, row) => col >= 0 && row >= 0 && col < width && row < height;

  function claim(col, row, owner) {
    const key = `${col},${row}`;
    const previous = painted.get(key);
    if (previous && previous !== owner) notes.push(`방 내부가 겹칩니다: (${col},${row}) — ${previous} ↔ ${owner}`);
    painted.set(key, owner);
  }

  function paintFloor(col, row, pick) {
    if (!inBounds(col, row)) return;
    const i = idx(width, col, row);
    const tile = typeof pick === 'function' ? pick(col, row) : pick;
    if (tile > 0) back1[i] = tile;
    back2[i] = 0;
    front1[i] = 0;
    walkable[i] = NAV_ON;
    obstacle[i] = NAV_OFF;
  }

  function paintWall(col, row, pick) {
    if (!inBounds(col, row)) return;
    const i = idx(width, col, row);
    const tile = typeof pick === 'function' ? pick(col, row) : pick;
    if (tile > 0) back2[i] = tile;
    walkable[i] = NAV_OFF;
    obstacle[i] = NAV_ON;
  }

  function outOfBounds(rect, label) {
    if (rect.col < 0 || rect.row < 0 || rect.col + rect.width > width || rect.row + rect.height > height) {
      notes.push(`${label}: rect 가 맵(${width}×${height}) 밖으로 나갑니다 — 잘립니다.`);
    }
  }

  const objects = [];
  const spawnPoints = [];
  const spawnRequests = [];

  // ── 1. 영역 — 방이 아닌 넓은 지형 (중정·못·복도). 벽을 만들지 않는다 ──
  //
  // `areas` 는 방보다 **먼저**, `overlays` 는 방·문보다 **나중에** 칠한다.
  // 방 안에 못이나 욕조 같은 지형을 넣으려면 overlays 로 얹어야 방에 덮이지 않는다.
  function paintArea(area, index, kind) {
    const label = `${kind}[${index}] "${area.name || ''}"`;
    const rect = rectOf(area.rect, label);
    outOfBounds(rect, label);
    const pick = tilePicker(area.tile, `${label}.tile`);
    const walkable_ = area.walkable === true;
    const blocked = area.obstacle != null ? area.obstacle === true : !walkable_;
    const onFront = area.layer === 'front';
    for (let row = rect.row; row < rect.row + rect.height; row += 1) {
      for (let col = rect.col; col < rect.col + rect.width; col += 1) {
        if (!inBounds(col, row)) continue;
        const i = idx(width, col, row);
        const t = pick(col, row);
        if (t > 0) (onFront ? front1 : back1)[i] = t;
        walkable[i] = walkable_ ? NAV_ON : NAV_OFF;
        obstacle[i] = blocked ? NAV_ON : NAV_OFF;
      }
    }
    if (area.name) {
      objects.push({
        id: area.id ? `obj_${area.id}` : objectId(200 + index),
        name: String(area.name),
        tags: Array.isArray(area.tags) ? area.tags.map(String) : ['area'],
        description: String(area.description || ''),
        rect: { ...rect },
        color: String(area.color || ''),
      });
    }
  }

  (Array.isArray(config.areas) ? config.areas : [])
    .forEach((area, index) => paintArea(area, index, 'areas'));

  // ── 2. 방 ──────────────────────────────────────────────
  const rooms = Array.isArray(config.rooms) ? config.rooms : [];

  rooms.forEach((room, index) => {
    const label = `rooms[${index}] "${room.name || room.id || ''}"`;
    const rect = rectOf(room.rect, label);
    outOfBounds(rect, label);
    const floorTile = tilePicker(room.floor ?? defaultFloorRef, `${label}.floor`);
    const wallTile = tilePicker(room.wall ?? defaultWallRef, `${label}.wall`);
    const wallTopRef = room.wallTop ?? defaultWallTopRef;
    const wallTopTile = wallTopRef ? tilePicker(wallTopRef, `${label}.wallTop`) : null;
    const hasWalls = room.walls !== false;

    for (let row = rect.row; row < rect.row + rect.height; row += 1) {
      for (let col = rect.col; col < rect.col + rect.width; col += 1) {
        if (!inBounds(col, row)) continue;
        const isEdge = hasWalls && (
          col === rect.col || row === rect.row
          || col === rect.col + rect.width - 1 || row === rect.row + rect.height - 1
        );
        if (isEdge) {
          // 테두리는 겹쳐도 정상이다 — 인접한 두 방이 벽 한 줄을 나눠 쓰는 형태.
          const isNorth = row === rect.row;
          paintWall(col, row, isNorth && wallTopTile ? wallTopTile : wallTile);
        } else {
          claim(col, row, label);
          paintFloor(col, row, floorTile);
        }
      }
    }

    // 오브젝트(구역 메타) — 월드에서 "이 방이 무엇인지" 를 읽는 유일한 자리
    objects.push({
      id: room.id ? `obj_${room.id}` : objectId(index),
      name: String(room.name || room.id || `방 ${index + 1}`),
      tags: Array.isArray(room.tags) ? room.tags.map(String) : ['room'],
      description: String(room.description || ''),
      rect: { ...rect },
      color: String(room.color || ''),
    });

    // 스폰은 나중에 확정한다 — 가구·흩뿌리기가 이 뒤에 칠하므로, 지금 중앙을
    // 잡아두면 그 칸이 가구에 덮여 "설 수 없는 스폰"이 된다 (실제로 겪었다).
    if (room.spawn !== false) {
      const spawn = typeof room.spawn === 'object' && room.spawn !== null ? room.spawn : {};
      spawnRequests.push({
        rect,
        label: String(spawn.label || room.name || room.id || ''),
        x: Number.isFinite(Number(spawn.x)) ? Math.trunc(Number(spawn.x)) : null,
        y: Number.isFinite(Number(spawn.y)) ? Math.trunc(Number(spawn.y)) : null,
      });
    }
  });

  // ── 3. 복도 (방 벽을 덮어써서 통로를 낸다) ───────────────
  const corridors = Array.isArray(config.corridors) ? config.corridors : [];
  corridors.forEach((corridor, index) => {
    const label = `corridors[${index}] "${corridor.name || ''}"`;
    const rect = rectOf(corridor.rect, label);
    outOfBounds(rect, label);
    const floorTile = tilePicker(corridor.floor ?? defaultFloorRef, `${label}.floor`);
    for (let row = rect.row; row < rect.row + rect.height; row += 1) {
      for (let col = rect.col; col < rect.col + rect.width; col += 1) {
        paintFloor(col, row, floorTile);
      }
    }
    if (corridor.name) {
      objects.push({
        id: corridor.id ? `obj_${corridor.id}` : objectId(100 + index),
        name: String(corridor.name),
        tags: Array.isArray(corridor.tags) ? corridor.tags.map(String) : ['corridor'],
        description: String(corridor.description || ''),
        rect: { ...rect },
        color: String(corridor.color || ''),
      });
    }
  });

  // ── 4. 문 (방 테두리의 특정 칸을 뚫는다) ────────────────
  rooms.forEach((room, index) => {
    const doors = Array.isArray(room.doors) ? room.doors : [];
    if (doors.length === 0) return;
    const rect = rectOf(room.rect, `rooms[${index}]`);
    const floorTile = tilePicker(room.floor ?? defaultFloorRef, `rooms[${index}].floor`);
    doors.forEach((door, doorIndex) => {
      const label = `rooms[${index}].doors[${doorIndex}]`;
      const side = String(door.side || '').trim();
      const span = Math.max(1, Math.trunc(Number(door.width) || 1));
      const horizontal = side === 'north' || side === 'south';
      const centre = horizontal
        ? rect.col + Math.floor(rect.width / 2)
        : rect.row + Math.floor(rect.height / 2);
      const at = Number.isFinite(Number(door.at)) ? Math.trunc(Number(door.at)) : centre;

      let cells = [];
      if (side === 'north') cells = Array.from({ length: span }, (_, k) => [at + k, rect.row]);
      else if (side === 'south') cells = Array.from({ length: span }, (_, k) => [at + k, rect.row + rect.height - 1]);
      else if (side === 'west') cells = Array.from({ length: span }, (_, k) => [rect.col, at + k]);
      else if (side === 'east') cells = Array.from({ length: span }, (_, k) => [rect.col + rect.width - 1, at + k]);
      else {
        notes.push(`${label}: side 는 north|south|east|west 중 하나여야 합니다 (받은 값 "${side}") — 무시합니다.`);
        return;
      }
      const tile = door.floor != null ? tilePicker(door.floor, `${label}.floor`) : floorTile;
      for (const [col, row] of cells) {
        if (!inBounds(col, row)) {
          notes.push(`${label}: (${col},${row}) 가 맵 밖입니다 — 무시합니다.`);
          continue;
        }
        paintFloor(col, row, tile);
      }
    });
  });

  // ── 4-b. 겹쳐 칠하기 — 방 안의 못·욕조처럼 방보다 나중에 와야 하는 지형 ──
  (Array.isArray(config.overlays) ? config.overlays : [])
    .forEach((area, index) => paintArea(area, index, 'overlays'));

  // ── 5. 소품 (front_1 에 얹는다) ─────────────────────────
  const props = Array.isArray(config.props) ? config.props : [];
  props.forEach((prop, index) => {
    const label = `props[${index}]`;
    const tile = tileId(prop.tile, `${label}.tile`);
    const cells = Array.isArray(prop.at) && Array.isArray(prop.at[0]) ? prop.at : [prop.at];
    for (const cell of cells) {
      const col = Math.trunc(Number(Array.isArray(cell) ? cell[0] : cell?.col));
      const row = Math.trunc(Number(Array.isArray(cell) ? cell[1] : cell?.row));
      if (!Number.isInteger(col) || !Number.isInteger(row) || !inBounds(col, row)) {
        notes.push(`${label}: 좌표 ${JSON.stringify(cell)} 를 읽을 수 없거나 맵 밖입니다 — 무시합니다.`);
        continue;
      }
      const i = idx(width, col, row);
      if (tile > 0) front1[i] = tile;
      if (prop.blocking !== false) {
        walkable[i] = NAV_OFF;
        obstacle[i] = NAV_ON;
      }
    }
  });

  // ── 5-b. 스탬프 — 침대·소파·식탁처럼 여러 칸을 차지하는 가구 ──
  //
  // 타일셋의 가구는 대개 2×2, 3×1 조각으로 그려져 있다. 한 칸씩 찍으면
  // 침대가 침대로 안 보인다. 조각 배열을 통째로 얹는다.
  const stamps = Array.isArray(config.stamps) ? config.stamps : [];
  stamps.forEach((stamp, index) => {
    const label = `stamps[${index}]`;
    const grid = Array.isArray(stamp.stamp) ? stamp.stamp : [];
    if (grid.length === 0 || !Array.isArray(grid[0])) {
      notes.push(`${label}: stamp 는 타일 이름의 2차원 배열이어야 합니다 — 무시합니다.`);
      return;
    }
    const spots = Array.isArray(stamp.at) && Array.isArray(stamp.at[0]) ? stamp.at : [stamp.at];
    const blocking = stamp.blocking !== false;
    const onFront = stamp.layer !== 'back';
    let placed = 0;
    let refused = 0;
    for (const spot of spots) {
      const col0 = Math.trunc(Number(Array.isArray(spot) ? spot[0] : spot?.col));
      const row0 = Math.trunc(Number(Array.isArray(spot) ? spot[1] : spot?.row));
      if (!Number.isInteger(col0) || !Number.isInteger(row0)) {
        notes.push(`${label}: 좌표 ${JSON.stringify(spot)} 를 읽을 수 없습니다 — 무시합니다.`);
        continue;
      }
      // 놓을 자리가 전부 비어 있고 통행 가능한지 먼저 본다. 벽에 걸치면 안 놓는다
      // (예전 코드는 벽에 구멍을 뚫어 방을 열어버렸다).
      let ok = true;
      for (let dy = 0; dy < grid.length && ok; dy += 1) {
        for (let dx = 0; dx < grid[dy].length && ok; dx += 1) {
          const col = col0 + dx;
          const row = row0 + dy;
          if (!inBounds(col, row)) { ok = false; break; }
          const i = idx(width, col, row);
          if (walkable[i] !== NAV_ON || front1[i] !== 0) ok = false;
        }
      }
      if (!ok) { refused += 1; continue; }
      for (let dy = 0; dy < grid.length; dy += 1) {
        for (let dx = 0; dx < grid[dy].length; dx += 1) {
          const ref = grid[dy][dx];
          if (ref == null || ref === '') continue;
          const col = col0 + dx;
          const row = row0 + dy;
          const i = idx(width, col, row);
          const t = tileId(ref, `${label}[${dy}][${dx}]`);
          if (t > 0) (onFront ? front1 : back1)[i] = t;
          if (blocking) { walkable[i] = NAV_OFF; obstacle[i] = NAV_ON; }
        }
      }
      placed += 1;
    }
    if (refused > 0) {
      notes.push(`${label}: ${placed}개 배치, ${refused}개는 자리가 막혀 건너뜀 (벽·다른 가구와 겹침)`);
    }
  });

  // ── 5-c. 9조각 — 테두리가 있는 카펫·바닥 영역 ──
  //
  // 타일셋의 카펫은 3×3 조각 세트(모서리 4 · 변 4 · 중앙 1)로 그려져 있다.
  // 중앙만 반복해 깔면 테두리가 없어 그냥 색 사각형이 된다.
  const nineSlices = Array.isArray(config.nineSlices) ? config.nineSlices : [];
  nineSlices.forEach((entry, index) => {
    const label = `nineSlices[${index}] "${entry.tile || ''}"`;
    const rect = rectOf(entry.rect, label);
    const base = String(entry.tile || '').trim();
    if (!base) { notes.push(`${label}: tile 이 필요합니다 — 무시합니다.`); return; }
    const blocking = entry.blocking === true;
    const onFront = entry.layer !== 'back';
    const part = (dx, dy) => {
      const v = dy === 0 ? 't' : (dy === rect.height - 1 ? 'b' : '');
      const h = dx === 0 ? 'l' : (dx === rect.width - 1 ? 'r' : '');
      return (v + h) || 'c';
    };
    for (let dy = 0; dy < rect.height; dy += 1) {
      for (let dx = 0; dx < rect.width; dx += 1) {
        const col = rect.col + dx;
        const row = rect.row + dy;
        if (!inBounds(col, row)) continue;
        const i = idx(width, col, row);
        if (walkable[i] !== NAV_ON || front1[i] !== 0) continue;  // 벽·가구 위에는 안 깐다
        const t = tileId(`${base}_${part(dx, dy)}`, label);
        if (t > 0) (onFront ? front1 : back1)[i] = t;
        if (blocking) { walkable[i] = NAV_OFF; obstacle[i] = NAV_ON; }
      }
    }
  });

  // ── 6. 흩뿌리기 — 숲처럼 넓은 면에 같은 소품을 결정적으로 배치 ──
  const scatters = Array.isArray(config.scatter) ? config.scatter : [];
  scatters.forEach((entry, index) => {
    const label = `scatter[${index}]`;
    const rect = entry.rect
      ? rectOf(entry.rect, label)
      : { col: 0, row: 0, width, height };
    const pick = tilePicker(entry.tile, `${label}.tile`);
    const density = Math.max(0, Math.min(1, Number(entry.density) || 0));
    const seed = Number(entry.seed) || (index + 1) * 31;
    const blocking = entry.blocking !== false;
    const onFront = entry.layer !== 'back';
    // onTile 을 주면 그 바닥 위에만 놓는다 — 도랑·성 내부를 침범하지 않게
    const allowed = entry.onTile != null
      ? new Set((Array.isArray(entry.onTile) ? entry.onTile : [entry.onTile])
        .flatMap((ref) => {
          const key = String(ref).split(':')[0];
          const list = theme?.aliases?.[key];
          return Array.isArray(list) ? list : [tileId(ref, `${label}.onTile`)];
        }))
      : null;
    let placed = 0;
    let skipped = 0;
    for (let row = rect.row; row < rect.row + rect.height; row += 1) {
      for (let col = rect.col; col < rect.col + rect.width; col += 1) {
        if (!inBounds(col, row)) continue;
        const i = idx(width, col, row);
        if (allowed && !allowed.has(back1[i])) { skipped += 1; continue; }
        if (front1[i] !== 0) { skipped += 1; continue; }   // 이미 뭔가 놓인 칸은 건너뛴다
        if (hash01(col, row, seed) >= density) continue;
        const t = pick(col, row);
        if (t > 0) (onFront ? front1 : back1)[i] = t;
        if (blocking) { walkable[i] = NAV_OFF; obstacle[i] = NAV_ON; }
        placed += 1;
      }
    }
    notes.push(`${label}: ${placed}칸 배치 (후보 밖 ${skipped}칸 건너뜀)`);
  });

  // ── 7. 스폰 확정 ────────────────────────────────────────
  // 방 중앙이 가구에 덮였으면 그 방 안에서 가장 가까운 통행 가능 칸으로 옮긴다.
  function findWalkableNear(rect, startCol, startRow) {
    if (inBounds(startCol, startRow) && walkable[idx(width, startCol, startRow)] === NAV_ON) {
      return [startCol, startRow];
    }
    const maxRing = Math.max(rect.width, rect.height);
    for (let ring = 1; ring <= maxRing; ring += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        for (let dx = -ring; dx <= ring; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const col = startCol + dx;
          const row = startRow + dy;
          if (col <= rect.col || row <= rect.row
            || col >= rect.col + rect.width - 1 || row >= rect.row + rect.height - 1) continue;
          if (!inBounds(col, row)) continue;
          if (walkable[idx(width, col, row)] === NAV_ON) return [col, row];
        }
      }
    }
    return null;
  }

  for (const request of spawnRequests) {
    const wantX = request.x ?? request.rect.col + Math.floor(request.rect.width / 2);
    const wantY = request.y ?? request.rect.row + Math.floor(request.rect.height / 2);
    const found = findWalkableNear(request.rect, wantX, wantY);
    if (!found) {
      notes.push(`스폰 "${request.label}": 방 안에 설 수 있는 칸이 없습니다 — 가구가 방을 다 덮었습니다.`);
      continue;
    }
    if (found[0] !== wantX || found[1] !== wantY) {
      notes.push(`스폰 "${request.label}": (${wantX},${wantY}) 가 막혀 (${found[0]},${found[1]}) 로 옮겼습니다.`);
    }
    spawnPoints.push({ x: found[0], y: found[1], label: request.label });
  }

  for (const point of Array.isArray(config.spawnPoints) ? config.spawnPoints : []) {
    spawnPoints.push({
      x: Math.trunc(Number(point?.x) || 0),
      y: Math.trunc(Number(point?.y) || 0),
      label: String(point?.label || ''),
    });
  }

  const record = normalizeMapRecord({
    name: config.name || config.slug || 'Unnamed Map',
    description: config.description || '',
    width,
    height,
    tileSize: Number(config.tileSize) || 32,
    tileSetAssetId: config.tileSetAssetId || theme?.assetId || undefined,
    tilesets: theme ? themesToTilesetAssets(theme) : [],
    layers: [
      { name: 'back_1', type: LAYER_TYPES.BACK, label: '지면', data: back1 },
      { name: 'back_2', type: LAYER_TYPES.BACK, label: '벽', data: back2 },
      { name: 'front_1', type: LAYER_TYPES.FRONT, label: '소품', data: front1 },
      { name: 'walkable', type: LAYER_TYPES.WALKABLE, data: walkable },
      { name: 'obstacle', type: LAYER_TYPES.OBSTACLE, data: obstacle },
    ],
    objects,
    spawnPoints,
    meta: { tags: Array.isArray(config.tags) ? config.tags : [] },
  });

  return { record, notes };
}

/** 터미널에서 한눈에 보는 용도. '#' 벽 · '.' 통행 · '@' 스폰 · ' ' 그 외 */
export function renderAscii(record) {
  const walkable = record.layers.find((l) => l.name === 'walkable');
  const obstacle = record.layers.find((l) => l.name === 'obstacle');
  const spawns = new Set(record.spawnPoints.map((p) => `${p.x},${p.y}`));
  const lines = [];
  for (let row = 0; row < record.height; row += 1) {
    let line = '';
    for (let col = 0; col < record.width; col += 1) {
      const i = idx(record.width, col, row);
      if (spawns.has(`${col},${row}`)) line += '@';
      else if (obstacle?.data[i] === NAV_ON) line += '#';
      else if (walkable?.data[i] === NAV_ON) line += '.';
      else line += ' ';
    }
    lines.push(line);
  }
  return lines.join('\n');
}
