/**
 * 실내 타일을 코드로 그린다 (프로토타입용).
 *
 * ★ 이건 파이프라인 검증용 임시 그림이다. 반복 텍스처(목재 바닥·회벽·타일)는
 *   쓸 만하지만 가구는 조잡하다. 진짜 타일이 생기면 시트만 갈아끼우면 되고
 *   레이아웃·검증·백업 생성은 그대로 재사용된다.
 */
import { Canvas, noise } from './png.mjs';

const T = 32;

const C = {
  woodDark: [110, 70, 34], wood: [139, 90, 43], woodLight: [163, 112, 60],
  plaster: [232, 220, 196], plasterDark: [206, 192, 166], beam: [110, 74, 44],
  doorWood: [107, 68, 35], doorPanel: [86, 54, 28], brass: [214, 178, 88],
  rug: [150, 52, 52], rugEdge: [196, 168, 108],
  linen: [240, 238, 230], blanket: [126, 86, 150], blanketDark: [102, 68, 124],
  sofa: [78, 132, 84], sofaLight: [98, 158, 104], sofaDark: [58, 102, 64],
  tileLight: [224, 226, 222], tileDark: [176, 182, 186], grout: [150, 156, 160],
  stone: [150, 152, 150], stoneDark: [120, 124, 126],
  porcelain: [240, 242, 246], water: [110, 180, 215], metal: [168, 174, 182],
  leaf: [74, 140, 72], leafDark: [54, 108, 56], pot: [170, 96, 60],
  shadow: [0, 0, 0, 60],
  book: [[176, 62, 58], [70, 106, 168], [200, 168, 76], [86, 146, 92], [140, 92, 160]],
};

function tile(draw) {
  const c = new Canvas(T, T);
  draw(c);
  return c;
}

/** 나뭇결 — 가로 널판, 세로 이음매를 줄마다 어긋나게 */
function woodPlanks(c, seed = 0, base = C.wood) {
  c.fill(0, 0, T, T, base);
  for (let y = 0; y < T; y += 1) {
    for (let x = 0; x < T; x += 1) {
      const n = noise(x, y, seed);
      if (n > 0.86) c.set(x, y, C.woodLight);
      else if (n < 0.12) c.set(x, y, C.woodDark);
    }
  }
  for (let y = 7; y < T; y += 8) c.hline(0, T - 1, y, C.woodDark);
  for (let band = 0; band < 4; band += 1) {
    const y0 = band * 8;
    const seam = ((band % 2) * 16 + 6 + (seed * 4) % 8) % T;
    c.vline(seam, y0, y0 + 6, C.woodDark);
  }
}

export function buildInteriorTiles() {
  return [
    {
      name: 'wood_floor', alias: 'wood_floor', category: 'floor', movement: 'passable',
      canvas: tile((c) => woodPlanks(c, 1)),
    },
    {
      name: 'wood_floor_b', alias: 'wood_floor:1', category: 'floor', movement: 'passable',
      canvas: tile((c) => woodPlanks(c, 5)),
    },
    {
      name: 'tile_floor', alias: 'tile_floor', category: 'floor', movement: 'passable',
      canvas: tile((c) => {
        for (let y = 0; y < T; y += 8) {
          for (let x = 0; x < T; x += 8) {
            const dark = ((x / 8) + (y / 8)) % 2 === 0;
            c.fill(x, y, 8, 8, dark ? C.tileDark : C.tileLight);
          }
        }
        for (let i = 0; i < T; i += 8) { c.hline(0, T - 1, i, C.grout); c.vline(i, 0, T - 1, C.grout); }
      }),
    },
    {
      name: 'stone_floor', alias: 'stone_floor', category: 'floor', movement: 'passable',
      canvas: tile((c) => {
        c.fill(0, 0, T, T, C.stone);
        for (let y = 0; y < T; y += 1) {
          for (let x = 0; x < T; x += 1) if (noise(x, y, 9) > 0.82) c.set(x, y, C.stoneDark);
        }
        for (let y = 0; y < T; y += 16) {
          c.hline(0, T - 1, y, C.stoneDark);
          c.vline((y / 16) % 2 === 0 ? 0 : 16, y, y + 15, C.stoneDark);
          c.vline((y / 16) % 2 === 0 ? 16 : 31, y, y + 15, C.stoneDark);
        }
      }),
    },
    {
      // 실내 벽: 회벽 + 아래쪽 나무 굽도리. 톱다운에서 아래 면이 보이는 형태
      name: 'wall', alias: 'wall', category: 'obstacle_blocking', movement: 'blocked',
      canvas: tile((c) => {
        c.fill(0, 0, T, T, C.plaster);
        for (let y = 0; y < T; y += 1) {
          for (let x = 0; x < T; x += 1) if (noise(x, y, 3) > 0.9) c.set(x, y, C.plasterDark);
        }
        c.fill(0, 0, T, 3, C.beam);
        c.fill(0, T - 6, T, 6, C.beam);
        c.hline(0, T - 1, T - 7, C.plasterDark);
        c.vline(0, 0, T - 1, C.plasterDark);
        c.vline(T - 1, 0, T - 1, C.plasterDark);
      }),
    },
    {
      name: 'door', alias: 'door', category: 'floor', movement: 'passable',
      canvas: tile((c) => {
        woodPlanks(c, 1);
        c.fill(3, 2, T - 6, T - 4, C.doorWood);
        c.outline(3, 2, T - 6, T - 4, C.doorPanel);
        c.outline(6, 5, 9, 10, C.doorPanel);
        c.outline(17, 5, 9, 10, C.doorPanel);
        c.outline(6, 17, 20, 11, C.doorPanel);
        c.fill(15, 20, 2, 2, C.brass);
      }),
    },
    {
      name: 'rug', alias: 'rug', category: 'decoration', movement: 'passable',
      canvas: tile((c) => {
        woodPlanks(c, 1);
        c.fill(1, 1, T - 2, T - 2, C.rug);
        c.outline(1, 1, T - 2, T - 2, C.rugEdge);
        c.outline(4, 4, T - 8, T - 8, C.rugEdge);
        for (let i = 8; i < T - 8; i += 4) { c.set(i, 15, C.rugEdge); c.set(i, 16, C.rugEdge); }
      }),
    },
    {
      name: 'bed', alias: 'bed', category: 'obstacle_blocking', movement: 'blocked',
      canvas: tile((c) => {
        woodPlanks(c, 1);
        c.fill(4, 1, 24, 30, C.wood);
        c.outline(4, 1, 24, 30, C.woodDark);
        c.fill(6, 3, 20, 9, C.linen);          // 베개
        c.outline(6, 3, 20, 9, C.plasterDark);
        c.fill(6, 13, 20, 16, C.blanket);      // 이불
        c.outline(6, 13, 20, 16, C.blanketDark);
        c.hline(7, 24, 18, C.blanketDark);
      }),
    },
    {
      name: 'sofa', alias: 'sofa', category: 'obstacle_blocking', movement: 'blocked',
      canvas: tile((c) => {
        woodPlanks(c, 1);
        c.fill(2, 8, 28, 20, C.sofa);
        c.outline(2, 8, 28, 20, C.sofaDark);
        c.fill(2, 4, 28, 7, C.sofaLight);      // 등받이
        c.outline(2, 4, 28, 7, C.sofaDark);
        c.fill(2, 11, 5, 16, C.sofaDark);      // 팔걸이
        c.fill(25, 11, 5, 16, C.sofaDark);
        c.fill(8, 13, 7, 12, C.sofaLight);     // 방석
        c.fill(17, 13, 7, 12, C.sofaLight);
      }),
    },
    {
      name: 'bookshelf', alias: 'bookshelf', category: 'obstacle_blocking', movement: 'blocked',
      canvas: tile((c) => {
        woodPlanks(c, 1);
        c.fill(1, 1, 30, 30, C.wood);
        c.outline(1, 1, 30, 30, C.woodDark);
        for (let shelf = 0; shelf < 3; shelf += 1) {
          const y = 3 + shelf * 9;
          c.fill(3, y, 26, 7, C.woodDark);
          let x = 4;
          let i = 0;
          while (x < 28) {
            const w = 2 + Math.floor(noise(x, shelf, 7) * 3);
            const h = 4 + Math.floor(noise(x, shelf, 11) * 3);
            c.fill(x, y + 7 - h, Math.min(w, 28 - x), h, C.book[(i + shelf) % C.book.length]);
            x += w + 1;
            i += 1;
          }
        }
      }),
    },
    {
      name: 'table', alias: 'table', category: 'obstacle_blocking', movement: 'blocked',
      canvas: tile((c) => {
        woodPlanks(c, 1);
        c.fill(3, 5, 26, 22, C.woodLight);
        c.outline(3, 5, 26, 22, C.woodDark);
        c.fill(5, 27, 4, 4, C.woodDark);
        c.fill(23, 27, 4, 4, C.woodDark);
        c.hline(5, 26, 16, C.wood);
      }),
    },
    {
      name: 'bathtub', alias: 'bathtub', category: 'obstacle_blocking', movement: 'blocked',
      canvas: tile((c) => {
        c.fill(0, 0, T, T, C.tileLight);
        for (let i = 0; i < T; i += 8) { c.hline(0, T - 1, i, C.grout); c.vline(i, 0, T - 1, C.grout); }
        c.fill(2, 5, 28, 24, C.porcelain);
        c.outline(2, 5, 28, 24, C.metal);
        c.fill(5, 8, 22, 18, C.water);
        c.outline(5, 8, 22, 18, C.porcelain);
        c.fill(14, 2, 4, 4, C.metal);          // 수도꼭지
        c.fill(15, 6, 2, 3, C.metal);
      }),
    },
    {
      name: 'counter', alias: 'counter', category: 'obstacle_blocking', movement: 'blocked',
      canvas: tile((c) => {
        c.fill(0, 0, T, T, C.tileLight);
        for (let i = 0; i < T; i += 8) { c.hline(0, T - 1, i, C.grout); c.vline(i, 0, T - 1, C.grout); }
        c.fill(0, 6, T, 22, C.metal);          // 조리대
        c.outline(0, 6, T, 22, C.stoneDark);
        c.fill(4, 10, 14, 12, C.porcelain);    // 싱크
        c.outline(4, 10, 14, 12, C.stoneDark);
        c.fill(10, 6, 2, 5, C.stoneDark);      // 수전
        c.fill(22, 12, 8, 8, C.stoneDark);     // 화구
        c.fill(24, 14, 4, 4, C.metal);
      }),
    },
    {
      name: 'plant', alias: 'plant', category: 'obstacle_blocking', movement: 'blocked',
      canvas: tile((c) => {
        woodPlanks(c, 1);
        c.fill(11, 22, 10, 8, C.pot);
        c.outline(11, 22, 10, 8, C.woodDark);
        c.fill(10, 20, 12, 3, C.pot);
        for (let y = 4; y < 22; y += 1) {
          const spread = Math.floor((22 - y) * 0.55) + 2;
          for (let x = 16 - spread; x <= 16 + spread; x += 1) {
            const n = noise(x, y, 13);
            if (n > 0.42) c.set(x, y, n > 0.72 ? C.leafDark : C.leaf);
          }
        }
      }),
    },
    {
      name: 'chair', alias: 'chair', category: 'obstacle_blocking', movement: 'blocked',
      canvas: tile((c) => {
        woodPlanks(c, 1);
        c.fill(9, 6, 14, 4, C.woodDark);       // 등받이
        c.fill(8, 12, 16, 13, C.woodLight);    // 좌판
        c.outline(8, 12, 16, 13, C.woodDark);
        c.fill(9, 25, 3, 4, C.woodDark);
        c.fill(20, 25, 3, 4, C.woodDark);
      }),
    },
  ];
}
