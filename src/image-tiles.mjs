/**
 * 이미지 한 장 → 타일 + 역할 판정.
 *
 * 톱다운 맵 이미지를 격자로 자르고, 픽셀이 같은 칸을 합쳐 고유 타일을 뽑고,
 * 각 타일이 바닥인지 벽인지 물인지 이미지 특징으로 추정한다.
 *
 * 판정은 완벽하지 않다 — 돌담과 돌바닥은 색이 거의 같다. 그래서 이 모듈의 목표는
 * "정답"이 아니라 **사람이 교정할 후보를 좁히는 것**이다. 칸이 수천 개라도
 * 고유 타일은 수십 장이라, 그 수십 장만 보면 된다. 이게 SPUM 대비 실질적 이점이다.
 */

/** 셀 하나의 픽셀을 뽑는다 */
function readCell(img, col, row, cell) {
  const out = new Uint8Array(cell * cell * 4);
  for (let y = 0; y < cell; y += 1) {
    const sy = row * cell + y;
    if (sy >= img.height) break;
    for (let x = 0; x < cell; x += 1) {
      const sx = col * cell + x;
      if (sx >= img.width) break;
      const s = (sy * img.width + sx) * 4;
      const d = (y * cell + x) * 4;
      out[d] = img.data[s];
      out[d + 1] = img.data[s + 1];
      out[d + 2] = img.data[s + 2];
      out[d + 3] = img.data[s + 3];
    }
  }
  return out;
}

/**
 * 지각 서명 — 눈으로 같아 보이는 칸을 합친다.
 *
 * ★ 완전 일치(SPUM 의 `_tileSignature`)로는 실제 이미지가 거의 안 합쳐진다.
 *   `base-16x16-map-reference.png` 를 완전 일치로 자르면 256칸이 **256장** 그대로다
 *   (안티에일리어싱·노이즈로 칸마다 미세하게 다르다). SPUM 테마가 161장으로
 *   쪼개졌던 것도 같은 이유다.
 *
 *   그래서 칸을 blocks×blocks 로 나눠 평균색을 구하고 levels 단계로 양자화한다.
 *   같은 재질이면 같은 버킷에 떨어진다. blocks·levels 를 올리면 더 엄격해진다.
 */
function perceptualSignature(pixels, cell, blocks = 4, levels = 6) {
  const step = cell / blocks;
  const parts = [];
  for (let by = 0; by < blocks; by += 1) {
    for (let bx = 0; bx < blocks; bx += 1) {
      let n = 0; let sr = 0; let sg = 0; let sb = 0; let sa = 0;
      for (let y = Math.floor(by * step); y < Math.floor((by + 1) * step); y += 1) {
        for (let x = Math.floor(bx * step); x < Math.floor((bx + 1) * step); x += 1) {
          const i = (y * cell + x) * 4;
          sa += pixels[i + 3];
          if (pixels[i + 3] < 32) continue;
          n += 1; sr += pixels[i]; sg += pixels[i + 1]; sb += pixels[i + 2];
        }
      }
      const area = Math.max(1, Math.floor(step) ** 2);
      const alpha = Math.round((sa / area / 255) * (levels - 1));
      if (n === 0) { parts.push(`_${alpha}`); continue; }
      const q = (v) => Math.round((v / n / 255) * (levels - 1));
      parts.push(`${q(sr)}${q(sg)}${q(sb)}${alpha}`);
    }
  }
  return parts.join('.');
}

/** 픽셀 완전 일치 서명 — SPUM 의 슬라이스와 같은 기준 */
function signature(pixels) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < pixels.length; i += 1) {
    h1 = Math.imul(h1 ^ pixels[i], 0x01000193);
    h2 = Math.imul(h2 + pixels[i] + i, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`;
}

function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** 타일 통계 — 판정의 근거가 되는 숫자들 */
export function tileStats(pixels, cell) {
  let n = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let opaque = 0;
  for (let i = 0; i < cell * cell; i += 1) {
    const a = pixels[i * 4 + 3];
    if (a > 200) opaque += 1;
    if (a < 32) continue;
    n += 1;
    sr += pixels[i * 4];
    sg += pixels[i * 4 + 1];
    sb += pixels[i * 4 + 2];
  }
  if (n === 0) return null;
  const mr = sr / n;
  const mg = sg / n;
  const mb = sb / n;

  // 내부 색 분산 — 낮으면 평면(넓게 깔 수 있는 바닥 후보)
  let variance = 0;
  for (let i = 0; i < cell * cell; i += 1) {
    if (pixels[i * 4 + 3] < 32) continue;
    variance += (pixels[i * 4] - mr) ** 2 + (pixels[i * 4 + 1] - mg) ** 2 + (pixels[i * 4 + 2] - mb) ** 2;
  }
  const flat = Math.sqrt(variance / n);

  // 가장자리 일치도 — 좌↔우, 상↔하. 낮으면 이어붙는다
  const edge = (aIdx, bIdx) => {
    let sum = 0;
    for (let k = 0; k < cell; k += 1) {
      const a = aIdx(k) * 4;
      const b = bIdx(k) * 4;
      sum += Math.abs(pixels[a] - pixels[b]) + Math.abs(pixels[a + 1] - pixels[b + 1]) + Math.abs(pixels[a + 2] - pixels[b + 2]);
    }
    return sum / (cell * 3);
  };
  const tileH = edge((k) => k * cell, (k) => k * cell + cell - 1);
  const tileV = edge((k) => k, (k) => (cell - 1) * cell + k);

  // 어두운 픽셀 비율 — 윤곽선이 굵으면 사물/벽
  let dark = 0;
  for (let i = 0; i < cell * cell; i += 1) {
    if (pixels[i * 4 + 3] < 32) continue;
    if (pixels[i * 4] + pixels[i * 4 + 1] + pixels[i * 4 + 2] < 190) dark += 1;
  }

  const hsv = rgbToHsv(mr, mg, mb);
  return {
    rgb: [Math.round(mr), Math.round(mg), Math.round(mb)],
    hsv: { h: Math.round(hsv.h), s: +hsv.s.toFixed(2), v: +hsv.v.toFixed(2) },
    flat: +flat.toFixed(1),
    tileH: +tileH.toFixed(1),
    tileV: +tileV.toFixed(1),
    opaqueRatio: +(opaque / (cell * cell)).toFixed(3),
    darkRatio: +(dark / n).toFixed(3),
  };
}

/**
 * 역할 추정. 반환: floor | water | blocked | decoration
 *
 * 순서가 중요하다 — 앞의 조건이 이긴다.
 */
export function guessRole(stats, opts = {}) {
  const { hsv, flat, opaqueRatio, darkRatio } = stats;
  const floorBrightness = opts.floorBrightness ?? 0;

  // 밝고 어두운 픽셀이 적으면 바닥 — 손으로 그린 도면은 무늬가 있어 분산으로는
  // 못 가른다. 실측: 지중해 도면의 바닥은 v≈0.9, 벽은 v≈0.35 로 명도 차가 크다.
  if (floorBrightness > 0) {
    if (hsv.v >= floorBrightness && darkRatio <= (opts.floorDark ?? 0.12)) {
      return { role: 'floor', why: `밝음 ${hsv.v} 어두운픽셀 ${Math.round(darkRatio * 100)}%` };
    }
  }

  // 투명이 많이 섞이면 배경 위에 얹은 사물이다
  if (opaqueRatio < 0.9) return { role: 'decoration', why: `투명 ${Math.round((1 - opaqueRatio) * 100)}%` };

  // 파랑·청록 계열 + 채도 있으면 물
  if (hsv.h >= 175 && hsv.h <= 255 && hsv.s >= 0.25) return { role: 'water', why: `색조 ${hsv.h}° 채도 ${hsv.s}` };

  // 평면이고 가장자리가 맞으면 바닥 — 넓게 깔 수 있다
  if (flat <= 42 && stats.tileH <= 60 && stats.tileV <= 60) return { role: 'floor', why: `평면 ${flat} 가장자리 ${stats.tileH}/${stats.tileV}` };

  // 어두운 윤곽이 많으면 벽·사물
  if (darkRatio >= 0.18) return { role: 'blocked', why: `어두운 픽셀 ${Math.round(darkRatio * 100)}%` };

  // 분산이 크면 무늬가 튀는 것 — 넓게 깔면 안 되니 사물로 본다
  if (flat > 70) return { role: 'blocked', why: `분산 ${flat}` };

  return { role: 'floor', why: `평면 ${flat} (약)` };
}

/**
 * 이미지를 격자로 잘라 고유 타일을 뽑는다.
 * @returns {{ cell, cols, rows, tiles: Array, grid: number[] }}
 *   tiles[i] = { index, pixels, stats, role, why, count, cells: [[col,row]…] }
 *   grid[row*cols+col] = 타일 인덱스 (0 이상)
 */
export function sliceImage(img, cell, { exact = false, blocks = 4, levels = 6 } = {}) {
  const cols = Math.floor(img.width / cell);
  const rows = Math.floor(img.height / cell);
  const sigOf = exact
    ? (px) => signature(px)
    : (px) => perceptualSignature(px, cell, blocks, levels);
  const bySig = new Map();
  const tiles = [];
  const grid = new Array(cols * rows).fill(-1);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const pixels = readCell(img, col, row, cell);
      const sig = sigOf(pixels);
      let tile = bySig.get(sig);
      if (!tile) {
        const stats = tileStats(pixels, cell);
        const guess = stats ? guessRole(stats) : { role: 'empty', why: '전부 투명' };
        tile = {
          index: tiles.length,
          pixels,
          stats,
          role: guess.role,
          why: guess.why,
          count: 0,
          cells: [],
        };
        bySig.set(sig, tile);
        tiles.push(tile);
      }
      tile.count += 1;
      tile.cells.push([col, row]);
      grid[row * cols + col] = tile.index;
    }
  }
  return { cell, cols, rows, tiles, grid };
}

/**
 * 격자 크기 자동 추정 — 반복률(합쳐지는 비율)이 가장 높은 칸 크기를 고른다.
 * 타일맵 이미지는 올바른 칸 크기에서 같은 칸이 대량으로 반복된다.
 */
export function detectCellSize(img, candidates = [8, 12, 16, 24, 32, 48, 64], { exact = false, blocks = 4, levels = 6 } = {}) {
  const report = [];
  for (const cell of candidates) {
    const cols = Math.floor(img.width / cell);
    const rows = Math.floor(img.height / cell);
    if (cols < 4 || rows < 4) continue;
    const seen = new Set();
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const px = readCell(img, col, row, cell);
        seen.add(exact ? signature(px) : perceptualSignature(px, cell, blocks, levels));
      }
    }
    const total = cols * rows;
    report.push({ cell, cols, rows, total, unique: seen.size, repeat: +(1 - seen.size / total).toFixed(3) });
  }
  report.sort((a, b) => b.repeat - a.repeat || b.cell - a.cell);
  return { best: report[0] || null, report };
}

/**
 * 손으로 그린 평면도용 5종 판정 — 셀 안 픽셀을 하나씩 분류해 투표한다.
 *
 * 평균색으로는 안 된다. 32px 셀에 벽선(8px)과 바닥이 섞이면 평균이 중간값으로
 * 뭉개져 둘 다 아닌 값이 나온다. 픽셀별로 나누고 비율로 판단해야 한다.
 *
 * 임계값은 실측으로 정했다 (2026-08-19, 지중해 평면도 렌더):
 *   벽      v0.31 s0.47 · 바닥 v0.87~0.94 s0.07~0.16
 *   가구    v0.50~0.62 s0.33~0.56   (소파·의자·식탁)
 *   식재    g-r +9~+11              (야자수·관목)
 *   물      b-r +5~+10 이고 g-r 도 +   (분수·욕조 — 바닥은 b-r 이 -16 이하)
 *   계단    v0.65 s0.10             → 채도가 낮아 가구와 갈린다 (통행 유지)
 */
export function classifyPlanCell(pixels, cell, opts = {}) {
  const t = {
    wallValue: 0.45,
    furnSat: 0.25,
    furnValue: 0.80,
    wallRatio: 0.30,
    waterRatio: 0.22,
    plantRatio: 0.28,
    furnRatio: 0.38,
    ...opts,
  };
  let n = 0;
  const c = { wall: 0, water: 0, plant: 0, furniture: 0, floor: 0 };
  for (let i = 0; i < cell * cell; i += 1) {
    const a = pixels[i * 4 + 3];
    if (a < 32) continue;
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    n += 1;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const v = max / 255;
    const s = max === 0 ? 0 : (max - min) / max;
    if (b - r >= 3 && g - r >= 3) { c.water += 1; continue; }        // 청록 — 물
    if (g - r >= 5 && b - r < 0) { c.plant += 1; continue; }         // 초록 — 식재
    if (v < t.wallValue) { c.wall += 1; continue; }                  // 어두움 — 벽
    if (v < t.furnValue && s >= t.furnSat) { c.furniture += 1; continue; } // 채도 있는 중간 — 가구
    c.floor += 1;
  }
  if (n === 0) return { role: 'floor', why: '빈 칸', ratio: {} };
  const ratio = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, +(v / n).toFixed(2)]));
  // 순서가 곧 우선순위다. 벽을 잃으면 방이 열려버리므로 벽을 먼저 본다.
  if (ratio.wall >= t.wallRatio) return { role: 'wall', why: `벽 ${Math.round(ratio.wall * 100)}%`, ratio };
  if (ratio.water >= t.waterRatio) return { role: 'water', why: `물 ${Math.round(ratio.water * 100)}%`, ratio };
  if (ratio.plant >= t.plantRatio) return { role: 'plant', why: `식재 ${Math.round(ratio.plant * 100)}%`, ratio };
  if (ratio.furniture >= t.furnRatio) return { role: 'furniture', why: `가구 ${Math.round(ratio.furniture * 100)}%`, ratio };
  return { role: 'floor', why: `바닥 ${Math.round(ratio.floor * 100)}%`, ratio };
}
