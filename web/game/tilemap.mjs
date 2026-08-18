/**
 * 타일맵 — 성의 마당. 16px 타일 48×32.
 *
 * 화법은 SPUM 맵 에디터 화면을 기준으로 삼았다. 앞선 판과 달라진 네 가지:
 *   1. 밝은 주광 팔레트 (낮 10~16시가 게임 시간대이므로 맞다)
 *   2. autotile — 지형이 만나는 칸에 경계 조각을 얹는다. 이게 없으면 색 블록이 맞닿아 도식으로 보인다
 *   3. 물과 다리 — 성을 가르는 개울. 통로가 물을 건너는 곳에 다리가 놓인다
 *   4. 여러 칸을 쓰는 소품 — 나무는 2×3칸이고 그림자가 있다. 타일 한 칸 안에 그린 소품은 납작하다
 *
 * 좌표계: 논리 픽셀. world.mjs 의 LAYOUT 은 16 배수에 스냅되어 있다.
 */

export const TILE = 16;
export const GRID = Object.freeze({ w: 48, h: 32 });
export const MAP_PX = Object.freeze({ w: GRID.w * TILE, h: GRID.h * TILE });

export const T = Object.freeze({
  GRASS: 0, DIRT: 1, WATER: 2, BRIDGE: 3,
  STONE: 4, WOOD: 5, BRICK: 6, STRAW: 7,
  WALL: 8, WALL_TOP: 9, DOOR: 10,
});

export const ROOM_FLOOR = Object.freeze({
  archive: T.STONE, quarters: T.WOOD, gate: T.STONE,
  court: T.GRASS, kitchen: T.BRICK, yard: T.STRAW,
});

/** 개울이 흐르는 열 (안뜰과 오른쪽 건물 사이) */
const STREAM = Object.freeze({ x0: 30, x1: 32 });

/** 결정론 해시 — 같은 칸은 항상 같은 무늬. 매 프레임 흔들리면 눈이 아프다. */
function h2(x, y, salt = 0) {
  let n = (x * 374761393 + y * 668265263 + salt * 2246822519) >>> 0;
  n = ((n ^ (n >> 13)) * 1274126177) >>> 0;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
}

// ────────────────────────────────────────────────── 맵 생성
export function buildTileMap(layout, hub) {
  const map = new Uint8Array(GRID.w * GRID.h).fill(T.GRASS);
  const idx = (x, y) => (x >= 0 && y >= 0 && x < GRID.w && y < GRID.h ? y * GRID.w + x : -1);
  const put = (x, y, v) => { const i = idx(x, y); if (i >= 0) map[i] = v; };
  const get = (x, y) => { const i = idx(x, y); return i >= 0 ? map[i] : T.GRASS; };

  const hubT = { x: Math.floor(hub.x / TILE), y: Math.floor(hub.y / TILE) };

  // 1) 개울 — 곧게 흐르지 않게 열마다 살짝 흔든다
  for (let y = 0; y < GRID.h; y += 1) {
    const wob = Math.round(Math.sin(y / 4.5) * 1.2);
    for (let x = STREAM.x0 + wob; x <= STREAM.x1 + wob; x += 1) put(x, y, T.WATER);
  }

  // 2) 통로. 물을 건너는 칸은 다리가 된다.
  const layPath = (x, y) => put(x, y, get(x, y) === T.WATER ? T.BRIDGE : T.DIRT);
  for (const [id, r] of Object.entries(layout)) {
    if (id === 'court') continue;
    const d = { x: Math.floor(r.door.x / TILE), y: Math.floor(r.door.y / TILE) };
    const sx = Math.sign(hubT.x - d.x);
    const sy = Math.sign(hubT.y - d.y);
    // 문에서 수직으로 조금 나온 뒤 수평으로 붙는다 (L자). 대각선 통로는 타일에서 지저분하다.
    for (let y = d.y; y !== hubT.y; y += sy || 1) { layPath(d.x, y); layPath(d.x - 1, y); if (!sy) break; }
    for (let x = d.x; x !== hubT.x + sx; x += sx || 1) { layPath(x, hubT.y); layPath(x, hubT.y + 1); if (!sx) break; }
    layPath(d.x, d.y); layPath(d.x - 1, d.y);
  }

  // 3) 방 — 벽 링 + 바닥
  for (const [id, r] of Object.entries(layout)) {
    const x0 = r.x / TILE; const y0 = r.y / TILE;
    const x1 = (r.x + r.w) / TILE - 1; const y1 = (r.y + r.h) / TILE - 1;
    for (let x = x0 - 1; x <= x1 + 1; x += 1) { put(x, y0 - 1, T.WALL_TOP); put(x, y1 + 1, T.WALL); }
    for (let y = y0 - 1; y <= y1 + 1; y += 1) { put(x0 - 1, y, T.WALL); put(x1 + 1, y, T.WALL); }
    const f = ROOM_FLOOR[id] ?? T.STONE;
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) put(x, y, f);
  }

  // 4) 문 — 벽 방향에 맞춰 두 칸을 뚫는다
  for (const [id, r] of Object.entries(layout)) {
    if (id === 'court') continue;
    const dx = Math.floor(r.door.x / TILE); const dy = Math.floor(r.door.y / TILE);
    const x0 = r.x / TILE; const y0 = r.y / TILE;
    const x1 = (r.x + r.w) / TILE - 1; const y1 = (r.y + r.h) / TILE - 1;
    const vert = dx === x0 - 1 || dx === x1 + 1;
    const inward = vert ? { x: dx === x0 - 1 ? 1 : -1, y: 0 } : { x: 0, y: dy === y0 - 1 ? 1 : -1 };
    const span = vert ? [{ x: 0, y: 0 }, { x: 0, y: -1 }] : [{ x: 0, y: 0 }, { x: -1, y: 0 }];
    for (const o of span) {
      put(dx + o.x, dy + o.y, T.DOOR);
      put(dx + o.x + inward.x, dy + o.y + inward.y, ROOM_FLOOR[id] ?? T.STONE);
    }
  }

  // 5) 안뜰은 담 없이 열린 마당
  {
    const r = layout.court;
    const x0 = r.x / TILE - 1; const y0 = r.y / TILE - 1;
    const x1 = (r.x + r.w) / TILE; const y1 = (r.y + r.h) / TILE;
    for (let x = x0; x <= x1; x += 1) for (const y of [y0, y1]) {
      if (get(x, y) === T.WALL || get(x, y) === T.WALL_TOP) put(x, y, T.GRASS);
    }
    for (let y = y0; y <= y1; y += 1) for (const x of [x0, x1]) {
      if (get(x, y) === T.WALL || get(x, y) === T.WALL_TOP) put(x, y, T.GRASS);
    }
  }

  return { map, get };
}

/**
 * 소품 배치 — 나무·바위·통 등. 타일이 아니라 별도 층이다.
 * 여러 칸을 차지하고 그림자가 있어 입체로 보인다.
 */
export function buildProps(tiles, layout) {
  const props = [];
  const taken = new Set();
  const free = (tx, ty, w = 1, h = 1) => {
    for (let y = ty; y < ty + h; y += 1) for (let x = tx; x < tx + w; x += 1) {
      if (x < 0 || y < 0 || x >= GRID.w || y >= GRID.h) return false;
      if (tiles.get(x, y) !== T.GRASS) return false;
      if (taken.has(`${x},${y}`)) return false;
    }
    return true;
  };
  const claim = (tx, ty, w, h) => {
    for (let y = ty - 1; y < ty + h + 1; y += 1) for (let x = tx - 1; x < tx + w + 1; x += 1) taken.add(`${x},${y}`);
  };

  // 나무 — 2×3칸. 성 밖 풀밭에 밀집시킨다.
  for (let ty = 1; ty < GRID.h - 2; ty += 1) {
    for (let tx = 0; tx < GRID.w - 1; tx += 1) {
      if (!free(tx, ty, 2, 3)) continue;
      if (h2(tx, ty, 11) > 0.30) continue;
      props.push({ t: 'tree', tx, ty, v: h2(tx, ty, 3) });
      claim(tx, ty, 2, 3);
    }
  }
  // 떨기나무·바위·풀포기 — 한 칸
  for (let ty = 0; ty < GRID.h; ty += 1) {
    for (let tx = 0; tx < GRID.w; tx += 1) {
      if (!free(tx, ty)) continue;
      const r = h2(tx, ty, 23);
      if (r < 0.06) { props.push({ t: 'bush', tx, ty, v: r }); claim(tx, ty, 1, 1); }
      else if (r < 0.10) { props.push({ t: 'rock', tx, ty, v: r }); claim(tx, ty, 1, 1); }
      else if (r < 0.24) props.push({ t: 'tuft', tx, ty, v: r });
    }
  }

  // 방마다 고정 소품 — 장소를 구분하는 것은 색이 아니라 물건이다
  const R = (id) => ({
    x0: layout[id].x / TILE, y0: layout[id].y / TILE,
    x1: (layout[id].x + layout[id].w) / TILE - 1, y1: (layout[id].y + layout[id].h) / TILE - 1,
  });
  const fixed = [
    ['archive', 'shelf', 1, 1], ['archive', 'shelf', 4, 1], ['archive', 'shelf', 8, 1],
    ['archive', 'desk', 8, 4], ['archive', 'candle', 7, 4],
    ['quarters', 'bed', 1, 1], ['quarters', 'bed', 5, 1], ['quarters', 'bed', 9, 1],
    ['quarters', 'chest', 1, 5],
    ['gate', 'rack', 1, 1], ['gate', 'rack', 2, 1], ['gate', 'brazier', 9, 3], ['gate', 'desk', 6, 4],
    ['kitchen', 'hearth', 1, 1], ['kitchen', 'table', 5, 2], ['kitchen', 'barrel', 10, 4],
    ['kitchen', 'barrel', 9, 5], ['kitchen', 'pot', 3, 4],
    ['yard', 'hay', 1, 1], ['yard', 'stall', 6, 1], ['yard', 'woodpile', 1, 4], ['yard', 'bucket', 8, 4],
    ['court', 'well', 5, 3], ['court', 'bench', 1, 5], ['court', 'crate', 10, 1],
  ];
  for (const [room, t, ox, oy] of fixed) {
    const r = R(room);
    props.push({ t, tx: r.x0 + ox, ty: r.y0 + oy, v: h2(ox, oy, 7) });
  }

  // 울타리 — 뒷마당 앞쪽에 몇 칸
  {
    const r = R('yard');
    for (let i = 0; i < 6; i += 1) props.push({ t: 'fence', tx: r.x0 + 2 + i, ty: r.y1 + 2, v: 0 });
  }

  props.sort((a, b) => a.ty - b.ty);
  return props;
}

// ────────────────────────────────────────────────── 그리기
const P = {
  grass:  ['#4e8342', '#457a3a', '#5a9150'],
  grassHi:'#67a05a',
  dirt:   ['#c3a071', '#b8945f', '#cbab7e'],
  dirtHi: '#d8bb8f',
  water:  ['#3f7fc0', '#356fae', '#4a8ecd'],
  foam:   '#9ad4ef',
  stone:  ['#8e949c', '#848a92', '#9aa0a8'],
  wood:   ['#9a6a3c', '#8d6035', '#a67746'],
  brick:  ['#a4664e', '#986048', '#b07159'],
  straw:  ['#c4a94f', '#b89e45', '#d0b65c'],
  wall:   ['#6a707a', '#616770'],
  wallTop:['#8b939e', '#828a95'],
  door:   '#4a3a26',
  bridge: ['#a97b48', '#9c6f3f'],
};

const pick = (arr, v) => arr[Math.min(arr.length - 1, Math.floor(v * arr.length))];

/** 지형 서열 — 낮은 쪽 위에 높은 쪽의 경계가 얹힌다 */
const RANK = { [T.WATER]: 0, [T.GRASS]: 1, [T.DIRT]: 2, [T.BRIDGE]: 3, [T.STRAW]: 3, [T.STONE]: 4, [T.WOOD]: 4, [T.BRICK]: 4, [T.DOOR]: 4, [T.WALL]: 5, [T.WALL_TOP]: 5 };

function baseFill(ctx, t, x, y, v) {
  const g = (a) => { ctx.fillStyle = pick(a, v); ctx.fillRect(x, y, TILE, TILE); };
  switch (t) {
    case T.GRASS: g(P.grass); break;
    case T.DIRT: g(P.dirt); break;
    case T.WATER: g(P.water); break;
    case T.STONE: g(P.stone); break;
    case T.WOOD: g(P.wood); break;
    case T.BRICK: g(P.brick); break;
    case T.STRAW: g(P.straw); break;
    case T.WALL: g(P.wall); break;
    case T.WALL_TOP: g(P.wallTop); break;
    case T.BRIDGE: ctx.fillStyle = pick(P.water, v); ctx.fillRect(x, y, TILE, TILE); break;
    case T.DOOR: ctx.fillStyle = P.door; ctx.fillRect(x, y, TILE, TILE); break;
    default: g(P.grass);
  }
}

function texture(ctx, t, tx, ty) {
  const x = tx * TILE; const y = ty * TILE;
  switch (t) {
    case T.GRASS: // 풀결 점묘
      for (let i = 0; i < 5; i += 1) {
        const r = h2(tx * 4 + i, ty * 5 + i, 2);
        if (r < 0.45) continue;
        ctx.fillStyle = r > 0.86 ? P.grassHi : 'rgba(255,255,255,.06)';
        ctx.fillRect(x + ((r * 14) | 0), y + ((h2(ty + i, tx, 9) * 14) | 0), 2, 1);
      }
      break;
    case T.DIRT: // 자갈
      for (let i = 0; i < 4; i += 1) {
        const r = h2(tx * 5 + i, ty * 3 + i, 4);
        if (r < 0.6) continue;
        ctx.fillStyle = r > 0.85 ? P.dirtHi : 'rgba(0,0,0,.10)';
        ctx.fillRect(x + ((r * 13) | 0), y + ((h2(ty + i, tx, 6) * 13) | 0), 2, 1);
      }
      break;
    case T.WATER: { // 잔물결
      const r = h2(tx, ty, 8);
      ctx.strokeStyle = 'rgba(255,255,255,.16)';
      ctx.beginPath();
      const wy = y + 4 + ((r * 8) | 0);
      ctx.moveTo(x + 2, wy); ctx.lineTo(x + 6, wy - 1); ctx.lineTo(x + 10, wy); ctx.lineTo(x + 14, wy - 1);
      ctx.stroke();
      break;
    }
    case T.STONE: { // 엇쌓기 이음선
      ctx.strokeStyle = 'rgba(0,0,0,.22)';
      const off = ty % 2 ? 0 : 8;
      ctx.beginPath();
      ctx.moveTo(x, y + 8.5); ctx.lineTo(x + TILE, y + 8.5);
      ctx.moveTo(x + off + 0.5, y); ctx.lineTo(x + off + 0.5, y + 8);
      ctx.moveTo(x + ((off + 8) % 16) + 0.5, y + 8); ctx.lineTo(x + ((off + 8) % 16) + 0.5, y + TILE);
      ctx.stroke();
      break;
    }
    case T.WOOD:
      ctx.strokeStyle = 'rgba(0,0,0,.20)';
      ctx.beginPath();
      ctx.moveTo(x, y + 5.5); ctx.lineTo(x + TILE, y + 5.5);
      ctx.moveTo(x, y + 11.5); ctx.lineTo(x + TILE, y + 11.5);
      ctx.stroke();
      if (h2(tx, ty, 12) > 0.75) { ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x + 3, y + 2, 1, 1); }
      break;
    case T.BRICK: {
      ctx.strokeStyle = 'rgba(0,0,0,.22)';
      ctx.beginPath();
      for (let i = 0; i <= TILE; i += 5) { ctx.moveTo(x, y + i + 0.5); ctx.lineTo(x + TILE, y + i + 0.5); }
      const o = (ty % 2) * 4;
      for (let i = 0; i < TILE; i += 8) { ctx.moveTo(x + i + o + 0.5, y); ctx.lineTo(x + i + o + 0.5, y + TILE); }
      ctx.stroke();
      break;
    }
    case T.STRAW:
      ctx.strokeStyle = 'rgba(120,100,40,.40)';
      for (let i = 0; i < 4; i += 1) {
        const sx = x + ((h2(tx + i, ty, 5) * 13) | 0);
        const sy = y + ((h2(tx, ty + i, 5) * 13) | 0);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 4, sy + 2); ctx.stroke();
      }
      break;
    case T.WALL:
      ctx.strokeStyle = 'rgba(0,0,0,.34)';
      ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      ctx.fillStyle = 'rgba(255,255,255,.07)';
      ctx.fillRect(x + 1, y + 1, TILE - 2, 2);
      break;
    case T.WALL_TOP:
      ctx.strokeStyle = 'rgba(0,0,0,.28)';
      ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      ctx.fillStyle = 'rgba(255,255,255,.13)';
      ctx.fillRect(x + 1, y + 1, TILE - 2, 3);
      break;
    case T.BRIDGE: { // 널판 다리 — 물 위에 얹는다
      ctx.fillStyle = pick(P.bridge, h2(tx, ty, 3));
      ctx.fillRect(x, y + 1, TILE, TILE - 2);
      ctx.strokeStyle = 'rgba(0,0,0,.30)';
      ctx.beginPath();
      for (let i = 0; i < TILE; i += 4) { ctx.moveTo(x + i + 0.5, y + 1); ctx.lineTo(x + i + 0.5, y + TILE - 1); }
      ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,.35)';   // 난간
      ctx.fillRect(x, y, TILE, 2); ctx.fillRect(x, y + TILE - 2, TILE, 2);
      break;
    }
    case T.DOOR:
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(x, y, TILE, 5);
      ctx.strokeStyle = 'rgba(180,140,90,.30)';
      ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      break;
    default: break;
  }
}

/**
 * autotile 경계 — 이웃이 나보다 낮은 지형이면 그쪽에 내 색의 테두리를 흘린다.
 * 이게 없으면 색 블록이 딱 맞닿아 도식으로 보인다.
 */
function edges(ctx, tiles, tx, ty) {
  const x = tx * TILE; const y = ty * TILE;
  const me = tiles.get(tx, ty);
  const myRank = RANK[me] ?? 1;
  const N = [
    { dx: 0, dy: -1, side: 'top' }, { dx: 0, dy: 1, side: 'bottom' },
    { dx: -1, dy: 0, side: 'left' }, { dx: 1, dy: 0, side: 'right' },
  ];
  for (const n of N) {
    const nt = tiles.get(tx + n.dx, ty + n.dy);
    const nr = RANK[nt] ?? 1;
    if (nr >= myRank) continue;               // 내가 더 높을 때만 흘린다
    const isWater = nt === T.WATER;
    ctx.fillStyle = isWater ? 'rgba(0,0,0,.20)' : 'rgba(0,0,0,.16)';
    if (n.side === 'top') ctx.fillRect(x, y, TILE, 3);
    if (n.side === 'bottom') ctx.fillRect(x, y + TILE - 3, TILE, 3);
    if (n.side === 'left') ctx.fillRect(x, y, 3, TILE);
    if (n.side === 'right') ctx.fillRect(x + TILE - 3, y, 3, TILE);
  }
  // 물가 거품 — 물 쪽에서 육지를 향해
  if (me === T.WATER) {
    for (const n of N) {
      const nt = tiles.get(tx + n.dx, ty + n.dy);
      if (nt === T.WATER || nt === T.BRIDGE) continue;
      ctx.fillStyle = 'rgba(154,212,239,.55)';
      if (n.side === 'top') ctx.fillRect(x, y, TILE, 2);
      if (n.side === 'bottom') ctx.fillRect(x, y + TILE - 2, TILE, 2);
      if (n.side === 'left') ctx.fillRect(x, y, 2, TILE);
      if (n.side === 'right') ctx.fillRect(x + TILE - 2, y, 2, TILE);
    }
  }
}

export function paintTileMap(ctx, tiles) {
  ctx.imageSmoothingEnabled = false;
  for (let ty = 0; ty < GRID.h; ty += 1) {
    for (let tx = 0; tx < GRID.w; tx += 1) {
      const t = tiles.get(tx, ty);
      baseFill(ctx, t, tx * TILE, ty * TILE, h2(tx, ty, 1));
      texture(ctx, t, tx, ty);
    }
  }
  for (let ty = 0; ty < GRID.h; ty += 1) {
    for (let tx = 0; tx < GRID.w; tx += 1) edges(ctx, tiles, tx, ty);
  }
}
