/**
 * 우주선 실내 타일을 코드로 그린다.
 *
 * 왜 코드인가: 우주선 실내는 기하학적이다 — 갑판 패널, 리벳, 격벽 리브, 경고 줄무늬.
 * 나뭇결·풀잎 같은 유기적 질감과 달리 규칙적이라 절차적 생성이 잘 맞는다.
 * (CC0 팩은 Kenney 우주 계열이 전부 3D 킷이라 2D 타일 파이프라인에 안 맞았다.)
 *
 * src/tile-art.mjs 의 buildInteriorTiles() 와 같은 형태를 돌려주므로
 * scripts/make-tileset.mjs 의 시트 굽기·테마 생성이 그대로 재사용된다.
 */
import { Canvas, noise } from './png.mjs';

const T = 32;

const C = {
  deck: [58, 66, 78], deckLight: [78, 88, 102], deckDark: [42, 48, 58],
  rivet: [102, 112, 128], seam: [34, 39, 48],
  hull: [40, 46, 56], hullLight: [66, 74, 88], hullDark: [26, 30, 38],
  glow: [79, 216, 224], glowDim: [40, 132, 142],
  warn: [232, 148, 56], warnDark: [176, 104, 34],
  screen: [46, 184, 216], screenDark: [22, 86, 106], screenGlow: [140, 232, 246],
  crate: [126, 114, 88], crateDark: [92, 82, 62], crateEdge: [156, 142, 110],
  metal: [140, 150, 165], metalDark: [96, 104, 118],
  red: [222, 82, 70], green: [92, 208, 122],
  white: [228, 236, 244], space: [10, 12, 22], star: [236, 242, 255],
  fabric: [96, 106, 140], fabricDark: [70, 78, 106],
  leaf: [86, 174, 104], leafDark: [56, 124, 74], soil: [72, 60, 48],
  shadow: [0, 0, 0, 70],
};

function tile(draw) {
  const c = new Canvas(T, T);
  draw(c);
  return c;
}

/** 갑판 패널 — 이음매로 4등분하고 모서리에 리벳을 박는다 */
function deckPanel(c, seed = 0, base = C.deck) {
  c.fill(0, 0, T, T, base);
  for (let y = 0; y < T; y += 1) {
    for (let x = 0; x < T; x += 1) {
      const n = noise(x, y, seed);
      if (n > 0.9) c.set(x, y, C.deckLight);
      else if (n < 0.1) c.set(x, y, C.deckDark);
    }
  }
  // 이음매 — seed 에 따라 가로/세로 분할을 어긋나게 해서 넓게 깔아도 격자가 덜 보인다
  const split = 8 + ((seed * 5) % 3) * 4;
  c.hline(0, T - 1, split, C.seam);
  c.hline(0, T - 1, split + 1, C.deckLight);
  c.vline(((seed * 7) % 2) ? 15 : 21, split + 2, T - 1, C.seam);
  // 리벳
  for (const [rx, ry] of [[3, 3], [T - 4, 3], [3, split - 3], [T - 4, split - 3]]) {
    c.set(rx, ry, C.rivet); c.set(rx + 1, ry, C.rivet);
    c.set(rx, ry + 1, C.rivet); c.set(rx + 1, ry + 1, C.deckDark);
  }
}

/** 통풍 격자 — 가로 슬릿 */
function grate(c) {
  c.fill(0, 0, T, T, C.deckDark);
  for (let y = 2; y < T - 1; y += 5) {
    c.fill(2, y, T - 4, 3, C.hullDark);
    c.hline(2, T - 3, y, C.metalDark);
  }
  c.outline(0, 0, T, T, C.seam);
}

/** 선체 벽 — 세로 리브, 위쪽에 하이라이트 */
function hullWall(c, rib = true) {
  c.fill(0, 0, T, T, C.hull);
  for (let y = 0; y < T; y += 1) {
    for (let x = 0; x < T; x += 1) if (noise(x, y, 3) > 0.93) c.set(x, y, C.hullLight);
  }
  if (rib) for (let x = 4; x < T; x += 9) { c.vline(x, 0, T - 1, C.hullDark); c.vline(x + 1, 0, T - 1, C.hullLight); }
  c.hline(0, T - 1, 0, C.hullLight);
  c.hline(0, T - 1, T - 1, C.hullDark);
}

/** 우주가 보이는 창 */
function viewport(c) {
  hullWall(c, false);
  c.fill(5, 6, T - 10, T - 13, C.space);
  const stars = [[8, 9], [14, 12], [20, 8], [24, 16], [11, 18], [18, 20], [22, 11]];
  for (const [x, y] of stars) c.set(x, y, C.star);
  c.set(15, 15, C.glow); c.set(16, 15, C.glow); // 멀리 있는 행성
  c.outline(4, 5, T - 8, T - 11, C.metal);
  c.outline(5, 6, T - 10, T - 13, C.metalDark);
}

/** 제어 콘솔 — 화면과 버튼 */
function consoleDesk(c) {
  c.fill(0, 0, T, T, C.deck);
  c.fill(2, 8, T - 4, T - 12, C.metalDark);
  c.fill(3, 9, T - 6, 12, C.screenDark);
  for (let y = 10; y < 20; y += 3) c.hline(5, T - 8, y, C.screen);
  c.hline(5, 14, 12, C.screenGlow);
  c.fill(3, 23, T - 6, 4, C.hullDark);
  c.fill(5, 24, 2, 2, C.green); c.fill(9, 24, 2, 2, C.warn); c.fill(13, 24, 2, 2, C.red);
  c.outline(2, 8, T - 4, T - 12, C.metal);
}

/** 화물 상자 */
function crate(c, stacked = false) {
  c.fill(0, 0, T, T, C.deck);
  const y0 = stacked ? 3 : 6;
  c.fill(4, y0, T - 8, T - y0 - 4, C.crate);
  c.outline(4, y0, T - 8, T - y0 - 4, C.crateEdge);
  c.hline(5, T - 6, y0 + 6, C.crateDark);
  c.vline(15, y0 + 1, T - 6, C.crateDark);
  c.fill(12, y0 + 8, 8, 5, C.warn);
  c.hline(13, 18, y0 + 10, C.warnDark);
  if (stacked) { c.fill(6, 20, T - 12, 8, C.crateDark); c.outline(6, 20, T - 12, 8, C.crateEdge); }
}

/** 반응로 코어 — 발광 */
function reactor(c) {
  c.fill(0, 0, T, T, C.hullDark);
  c.outline(2, 2, T - 4, T - 4, C.metal);
  const cx = 16, cy = 16;
  for (let y = 0; y < T; y += 1) {
    for (let x = 0; x < T; x += 1) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < 5) c.set(x, y, C.glow);
      else if (d < 8) c.set(x, y, C.glowDim);
      else if (d < 10 && (x + y) % 3 === 0) c.set(x, y, C.glowDim);
    }
  }
  c.fill(14, 2, 4, 4, C.metalDark); c.fill(14, T - 6, 4, 4, C.metalDark);
}

export function buildShipTiles() {
  return [
    // ── 바닥 ──────────────────────────────────────────────
    { name: '갑판', alias: 'deck', category: 'floor', movement: 'passable', canvas: tile((c) => deckPanel(c, 1)) },
    { name: '갑판 b', alias: 'deck:1', category: 'floor', movement: 'passable', canvas: tile((c) => deckPanel(c, 4)) },
    { name: '갑판 c', alias: 'deck:2', category: 'floor', movement: 'passable', canvas: tile((c) => deckPanel(c, 7)) },
    { name: '함교 바닥', alias: 'bridge_floor', category: 'floor', movement: 'passable', canvas: tile((c) => deckPanel(c, 2, [76, 84, 96])) },
    { name: '화물칸 바닥', alias: 'cargo_floor', category: 'floor', movement: 'passable', canvas: tile((c) => deckPanel(c, 5, [66, 62, 56])) },
    { name: '통풍 격자', alias: 'grate', category: 'floor', movement: 'passable', canvas: tile(grate) },
    {
      name: '경고 줄무늬', alias: 'warn_stripe', category: 'decoration', movement: 'passable',
      canvas: tile((c) => {
        deckPanel(c, 3);
        for (let i = -T; i < T * 2; i += 8) {
          for (let y = 0; y < T; y += 1) { const x = i + y; if (x >= 0 && x < T) { c.set(x, y, C.warn); c.set(Math.min(x + 1, T - 1), y, C.warn); c.set(Math.max(x - 1, 0), y, C.warnDark); } }
        }
      }),
    },
    {
      name: '바닥 조명', alias: 'floor_light', category: 'decoration', movement: 'passable',
      canvas: tile((c) => { deckPanel(c, 6); c.fill(6, 14, T - 12, 4, C.glowDim); c.fill(7, 15, T - 14, 2, C.glow); }),
    },
    // ── 벽 ────────────────────────────────────────────────
    { name: '선체 벽', alias: 'hull', category: 'obstacle_blocking', movement: 'blocked', canvas: tile((c) => hullWall(c)) },
    { name: '격벽', alias: 'bulkhead', category: 'obstacle_blocking', movement: 'blocked', canvas: tile((c) => { hullWall(c, false); c.fill(0, 12, T, 8, C.hullDark); c.hline(0, T - 1, 12, C.metalDark); c.hline(0, T - 1, 19, C.metalDark); }) },
    { name: '전망창', alias: 'viewport', category: 'obstacle_blocking', movement: 'blocked', canvas: tile(viewport) },
    // ── 문 ────────────────────────────────────────────────
    {
      name: '에어락 문', alias: 'door', category: 'floor', movement: 'passable',
      canvas: tile((c) => {
        c.fill(0, 0, T, T, C.hull);
        c.fill(3, 2, T - 6, T - 4, C.metalDark);
        c.fill(4, 3, 11, T - 6, C.metal); c.fill(17, 3, 11, T - 6, C.metal);
        c.vline(15, 3, T - 4, C.hullDark); c.vline(16, 3, T - 4, C.hullDark);
        c.fill(6, 14, 4, 3, C.glow); c.fill(22, 14, 4, 3, C.glow);
        c.outline(3, 2, T - 6, T - 4, C.metal);
      }),
    },
    // ── 설비 · 장애물 ─────────────────────────────────────
    { name: '제어 콘솔', alias: 'console', category: 'obstacle_blocking', movement: 'blocked', canvas: tile(consoleDesk) },
    {
      name: '벽면 단말', alias: 'terminal', category: 'obstacle_blocking', movement: 'blocked',
      canvas: tile((c) => { hullWall(c, false); c.fill(6, 6, 20, 16, C.metalDark); c.fill(8, 8, 16, 10, C.screenDark); for (let y = 9; y < 17; y += 2) c.hline(9, 22, y, C.screen); c.outline(6, 6, 20, 16, C.metal); }),
    },
    { name: '화물 상자', alias: 'crate', category: 'obstacle_blocking', movement: 'blocked', canvas: tile((c) => crate(c, false)) },
    { name: '적재 화물', alias: 'crate_stack', category: 'obstacle_blocking', movement: 'blocked', canvas: tile((c) => crate(c, true)) },
    { name: '반응로', alias: 'reactor', category: 'obstacle_blocking', movement: 'blocked', canvas: tile(reactor) },
    {
      name: '배관', alias: 'pipe', category: 'obstacle_blocking', movement: 'blocked',
      canvas: tile((c) => {
        c.fill(0, 0, T, T, C.deck);
        for (const y0 of [7, 19]) { c.fill(0, y0, T, 6, C.metalDark); c.hline(0, T - 1, y0 + 1, C.metal); c.hline(0, T - 1, y0 + 5, C.hullDark); }
        c.fill(13, 5, 6, 22, C.metalDark); c.outline(13, 5, 6, 22, C.metal);
      }),
    },
    {
      name: '침상', alias: 'bunk', category: 'obstacle_blocking', movement: 'blocked',
      canvas: tile((c) => { deckPanel(c, 8); c.fill(3, 4, T - 6, T - 8, C.metalDark); c.fill(5, 6, T - 10, T - 12, C.fabric); c.fill(5, 6, T - 10, 7, C.white); c.hline(5, T - 6, 13, C.fabricDark); c.outline(3, 4, T - 6, T - 8, C.metal); }),
    },
    {
      name: '사물함', alias: 'locker', category: 'obstacle_blocking', movement: 'blocked',
      canvas: tile((c) => { hullWall(c, false); c.fill(4, 3, T - 8, T - 6, C.metalDark); c.vline(15, 4, T - 4, C.hullDark); for (const x of [11, 19]) c.fill(x, 15, 2, 4, C.metal); c.outline(4, 3, T - 8, T - 6, C.metal); }),
    },
    {
      name: '식탁', alias: 'mess_table', category: 'obstacle_blocking', movement: 'blocked',
      canvas: tile((c) => { deckPanel(c, 9); c.fill(4, 8, T - 8, T - 16, C.metal); c.outline(4, 8, T - 8, T - 16, C.metalDark); c.fill(13, 22, 6, 6, C.metalDark); }),
    },
    {
      name: '좌석', alias: 'seat', category: 'obstacle_blocking', movement: 'blocked',
      canvas: tile((c) => { deckPanel(c, 10); c.fill(8, 6, 16, 18, C.fabricDark); c.fill(9, 7, 14, 9, C.fabric); c.fill(9, 18, 14, 5, C.fabric); c.outline(8, 6, 16, 18, C.metalDark); }),
    },
    {
      name: '수경 재배', alias: 'hydro', category: 'obstacle_blocking', movement: 'blocked',
      canvas: tile((c) => {
        deckPanel(c, 11);
        c.fill(6, 16, 20, 11, C.metalDark); c.fill(7, 17, 18, 4, C.soil);
        for (const [x, y] of [[10, 12], [15, 9], [20, 13], [12, 7], [18, 6]]) { c.fill(x, y, 3, 5, C.leaf); c.set(x + 1, y + 5, C.leafDark); }
        c.outline(6, 16, 20, 11, C.metal);
      }),
    },
  ];
}
