/**
 * 건축 도면 이미지 → 셀별 역할 마스크.
 *
 * 타일맵 이미지와는 다르게 다뤄야 한다. 도면은 격자가 없고 벽이 얇은 선이라,
 * 그림을 타일로 쓰면 흐릿한 죽이 된다. 대신 **마스크로만 쓰고 그림은 테마로 칠한다**.
 *
 * 셀 하나에 들어간 픽셀들의 색 분포로 역할을 정한다:
 *   물(파랑) > 식재(초록) > 벽(어두움) > 외부(흰 여백) > 바닥(밝은 베이지)
 * 순서가 중요하다 — 벽 위에 식재가 겹친 칸은 식재로 보는 게 도면 의도에 맞다.
 */

function hsv(r, g, b) {
  const rn = r / 255; const gn = g / 255; const bn = b / 255;
  const max = Math.max(rn, gn, bn); const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

export const BLUEPRINT_ROLES = ['water', 'plant', 'wall', 'outside', 'floor'];

export const DEFAULT_THRESHOLDS = Object.freeze({
  water: 0.10,     // 파랑 픽셀 비율이 이 이상이면 물
  plant: 0.22,     // 초록
  wall: 0.34,      // 어두운 픽셀
  outside: 0.62,   // 흰 여백
});

/**
 * @param {{width,height,data}} img  잘라낸 도면 판
 * @param {number} cols  결과 맵의 가로 칸 수
 * @param {number} rows  결과 맵의 세로 칸 수
 * @returns {{ cols, rows, roles: string[], detail: object[] }}
 */
export function readBlueprint(img, cols, rows, thresholds = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const cw = img.width / cols;
  const ch = img.height / rows;
  const roles = new Array(cols * rows).fill('floor');
  const detail = new Array(cols * rows);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x0 = Math.floor(col * cw); const x1 = Math.max(x0 + 1, Math.floor((col + 1) * cw));
      const y0 = Math.floor(row * ch); const y1 = Math.max(y0 + 1, Math.floor((row + 1) * ch));
      let n = 0; let blue = 0; let green = 0; let dark = 0; let white = 0;
      let sr = 0; let sg = 0; let sb = 0;
      for (let y = y0; y < y1 && y < img.height; y += 1) {
        for (let x = x0; x < x1 && x < img.width; x += 1) {
          const i = (y * img.width + x) * 4;
          const r = img.data[i]; const g = img.data[i + 1]; const b = img.data[i + 2];
          n += 1; sr += r; sg += g; sb += b;
          const [h, s, v] = hsv(r, g, b);
          if (v > 0.93 && s < 0.07) { white += 1; continue; }
          if (v < 0.36) { dark += 1; continue; }
          if (h >= 175 && h <= 255 && s >= 0.18) { blue += 1; continue; }
          if (h >= 55 && h <= 170 && s >= 0.16) { green += 1; continue; }
        }
      }
      if (n === 0) continue;
      const ratio = { water: blue / n, plant: green / n, wall: dark / n, outside: white / n };
      let role = 'floor';
      if (ratio.water >= t.water) role = 'water';
      else if (ratio.plant >= t.plant) role = 'plant';
      else if (ratio.wall >= t.wall) role = 'wall';
      else if (ratio.outside >= t.outside) role = 'outside';
      const at = row * cols + col;
      roles[at] = role;
      detail[at] = {
        role,
        rgb: [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)],
        ratio: {
          water: +ratio.water.toFixed(2),
          plant: +ratio.plant.toFixed(2),
          wall: +ratio.wall.toFixed(2),
          outside: +ratio.outside.toFixed(2),
        },
      };
    }
  }
  return { cols, rows, roles, detail };
}

/**
 * 고해상도로 판독한 마스크를 목표 격자로 줄인다.
 *
 * ★ 왜 필요한가 (실측): 도면의 벽선은 3~5px 굵기다. 목표 격자(64×46)의 셀이
 *   5px면 벽선이 셀을 절반도 못 채워서, "어두운 픽셀 비율" 기준으로는 가구·그림자와
 *   구분되지 않는다. 실제로 방 경계가 아니라 가구를 따라 벽이 흩어졌다.
 *   판독은 2~3배 해상도로 하고(벽선이 셀을 꽉 채움) 그다음 줄이면 정확해진다.
 *
 * 줄일 때는 **우선순위**로 뭉갠다 — 벽이 한 칸이라도 있으면 벽이다. 벽이 끊기면
 * 방이 열려버리기 때문에, 벽을 잃는 쪽이 더 나쁜 실수다.
 */
export function downsampleMask(mask, cols, rows, priority = ['wall', 'water', 'plant', 'floor', 'outside']) {
  const sx = mask.cols / cols;
  const sy = mask.rows / rows;
  const roles = new Array(cols * rows).fill('floor');
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const seen = new Set();
      for (let y = Math.floor(row * sy); y < Math.max(Math.floor(row * sy) + 1, Math.floor((row + 1) * sy)); y += 1) {
        for (let x = Math.floor(col * sx); x < Math.max(Math.floor(col * sx) + 1, Math.floor((col + 1) * sx)); x += 1) {
          if (x < mask.cols && y < mask.rows) seen.add(mask.roles[y * mask.cols + x]);
        }
      }
      roles[row * cols + col] = priority.find((p) => seen.has(p)) || 'floor';
    }
  }
  return { cols, rows, roles, detail: [] };
}

/** 얇은 벽선이 셀 단위로 끊기는 것을 메운다 — 가로/세로로 이웃한 벽 사이의 한 칸 구멍 */
export function closeWallGaps(mask) {
  const { cols, rows, roles } = mask;
  const at = (c, r) => (c < 0 || r < 0 || c >= cols || r >= rows ? null : roles[r * cols + c]);
  const filled = [...roles];
  let count = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (roles[row * cols + col] === 'wall') continue;
      const h = at(col - 1, row) === 'wall' && at(col + 1, row) === 'wall';
      const v = at(col, row - 1) === 'wall' && at(col, row + 1) === 'wall';
      if (h || v) { filled[row * cols + col] = 'wall'; count += 1; }
    }
  }
  return { ...mask, roles: filled, closedGaps: count };
}

/** ASCII 미리보기 — 판독이 맞았는지 눈으로 본다 */
export function maskAscii(mask) {
  const CH = { wall: '#', floor: '.', plant: '*', water: '~', outside: ' ', door: '+', prop: 'o' };
  const lines = [];
  for (let row = 0; row < mask.rows; row += 1) {
    let line = '';
    for (let col = 0; col < mask.cols; col += 1) line += CH[mask.roles[row * mask.cols + col]] || '?';
    lines.push(line);
  }
  return lines.join('\n');
}

// ── 색 코드 마스크 ──────────────────────────────────────────
/**
 * AI 에게 "이 색으로 그려달라"고 요구한 뒤 읽는 방식.
 *
 * 왜 이렇게 하나 (실측 근거): 실제 건축 도면(지중해 저택)은 세피아 단색조라
 * 초록 픽셀이 0.1%(96/66,010)뿐이었고, 벽·바닥·포장이 모두 같은 색조(h30)에
 * 명도만 달라서 자동 판독이 가구와 벽을 구분하지 못했다.
 *
 * 반대로 **순수 채도 색**으로 그려달라고 하면 판독이 거의 실패하지 않는다.
 * JPEG 압축 잡음에도 견딘다 — 색 사이 거리가 멀기 때문이다.
 */
export const MASK_LEGEND = Object.freeze([
  { role: 'wall', hex: '#000000', rgb: [0, 0, 0], ko: '벽' },
  { role: 'floor', hex: '#FFFFFF', rgb: [255, 255, 255], ko: '실내 바닥' },
  { role: 'outside', hex: '#808080', rgb: [128, 128, 128], ko: '야외 지면' },
  { role: 'water', hex: '#0000FF', rgb: [0, 0, 255], ko: '물' },
  { role: 'plant', hex: '#00FF00', rgb: [0, 255, 0], ko: '식재·숲' },
  { role: 'door', hex: '#FFFF00', rgb: [255, 255, 0], ko: '문 (열림·통행)' },
  { role: 'window', hex: '#00FFFF', rgb: [0, 255, 255], ko: '창문 (막힘)' },
  { role: 'prop', hex: '#FF00FF', rgb: [255, 0, 255], ko: '가구·소품 (막힘)' },
]);

/**
 * 픽셀 하나를 범례 역할로 분류한다.
 *
 * ★ RGB 유클리드 거리를 쓰면 안 된다 (실측으로 확인한 실패):
 *     rgb(128,0,128) 어두운 마젠타 → 회색(128,128,128)이 더 가까워 'outside' 로 오판
 *     rgb(0,96,0)    어두운 초록   → 검정까지 96, 순초록까지 159 라 'wall' 로 오판
 *   JPEG 경계에서 색이 어두워지면 전부 검정·회색으로 빨려 들어간다.
 *
 *   그래서 **채도로 유채색/무채색을 먼저 가르고, 유채색은 색조로** 판단한다.
 *   무채색은 명도로 벽(어두움)·외부(중간)·바닥(밝음)을 가른다.
 */
const HUE_ROLES = [
  { role: 'door', hue: 60 },     // 노랑 — 문짝
  { role: 'plant', hue: 120 },   // 초록 — 식재
  // 물을 창문보다 앞에 둔다 — 연한 하늘색(색조 210)은 두 후보와 거리가 같은데,
  // 그 색은 분수·수면으로 오는 경우가 많다 (실측 rgb(96,160,224) = 색조 210).
  { role: 'water', hue: 240 },   // 파랑 — 물
  { role: 'window', hue: 180 },  // 청록 — 창문
  { role: 'prop', hue: 300 },    // 마젠타 — 가구
];

export function classifyLegendPixel(r, g, b, { satCut = 0.55, darkCut = 0.34, lightCut = 0.72 } = {}) {
  // satCut 은 "순수 채도색인가"의 기준이다. 범례는 순수색을 쓰라고 요구하므로
  // 실제 순수색 픽셀은 채도 0.85~1.0 으로 온다 (실측: 마젠타 0.99, 초록 0.86).
  //
  // ★ 이 값을 낮게 두면 안 된다. 0.22 로 뒀을 때 마스크에 남은 나무 줄기 갈색
  //   (h47 s0.32 v0.28) 이 색조상 노랑(60)에 가까워 '문' 787칸으로 오판됐다.
  //   갈색·올리브처럼 채도가 어중간한 색은 유채색으로 보지 말고 명도로 판단해야 한다.
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max / 255;
  const s = max === 0 ? 0 : (max - min) / max;
  if (s < satCut) {
    if (v < darkCut) return 'wall';
    if (v > lightCut) return 'floor';
    return 'outside';
  }
  const d = max - min;
  let hue;
  if (max === r) hue = (((g - b) / d) % 6) * 60;
  else if (max === g) hue = ((b - r) / d + 2) * 60;
  else hue = ((r - g) / d + 4) * 60;
  if (hue < 0) hue += 360;
  let best = HUE_ROLES[0];
  let bestD = 360;
  for (const cand of HUE_ROLES) {
    const diff = Math.min(Math.abs(hue - cand.hue), 360 - Math.abs(hue - cand.hue));
    if (diff < bestD) { bestD = diff; best = cand; }
  }
  return best.role;
}

/**
 * 색 코드 마스크 판독 — 셀 안 픽셀을 하나씩 분류해 투표한다.
 * (평균색을 쓰면 경계 셀에서 두 색이 섞여 엉뚱한 것이 나온다)
 */
export function readColorMask(img, cols, rows, { legend = MASK_LEGEND, minConfidence = 0.35, priority = {} } = {}) {
  // 얇은 선으로 그려진 것(벽·문)은 셀 안에서 최다 득표를 못 얻는다. 비율만
  // 넘으면 이기게 해줘야 한다 — 벽을 놓치면 방이 열려버리므로 손실이 더 크다.
  // 실측: 896px 폭을 28칸으로 나누니 검정 벽선이 셀의 20%밖에 못 채워 21칸만 잡혔다.
  //
  // ★ 다만 임계를 낮추면 반대 사고가 난다. AI 가 마스크 판에도 검정 윤곽선을 그리면
  //   윤곽선이 있는 모든 것(야자수·가구)이 벽으로 이겨버린다 — 실측으로 확인했다
  //   (0.18 일 때 벽 474칸, 야자수까지 벽. 0.5 로 올리면 239칸으로 정상화).
  //   그래서 기본값을 0.5 로 둔다. 격자가 굵어 벽이 안 잡히면 격자를 촘촘히 하는 게
  //   임계를 낮추는 것보다 낫다.
  // 창문·문짝은 벽 안에 얇게 그려지므로 벽에 지지 않게 우선순위를 준다
  const prio = { window: 0.3, door: 0.32, wall: 0.5, water: 0.3, plant: 0.4, ...priority };
  const cw = img.width / cols;
  const ch = img.height / rows;
  const roles = new Array(cols * rows).fill('floor');
  const detail = new Array(cols * rows);
  let lowConfidence = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x0 = Math.floor(col * cw); const x1 = Math.max(x0 + 1, Math.floor((col + 1) * cw));
      const y0 = Math.floor(row * ch); const y1 = Math.max(y0 + 1, Math.floor((row + 1) * ch));
      const votes = new Array(legend.length).fill(0);
      let n = 0;
      for (let y = y0; y < y1 && y < img.height; y += 1) {
        for (let x = x0; x < x1 && x < img.width; x += 1) {
          const i = (y * img.width + x) * 4;
          const role = classifyLegendPixel(img.data[i], img.data[i + 1], img.data[i + 2]);
          const k = legend.findIndex((l) => l.role === role);
          if (k >= 0) votes[k] += 1;
          n += 1;
        }
      }
      if (n === 0) continue;
      let win = 0;
      for (let k = 1; k < votes.length; k += 1) if (votes[k] > votes[win]) win = k;
      // 우선순위 규칙 — 순서대로 검사해 비율을 넘으면 그것으로 확정
      for (const role of ['window', 'door', 'wall', 'water', 'plant']) {
        const k = legend.findIndex((l) => l.role === role);
        if (k < 0 || prio[role] == null) continue;
        if (votes[k] / n >= prio[role]) { win = k; break; }
      }
      const confidence = votes[win] / n;
      if (confidence < minConfidence) lowConfidence += 1;
      const at = row * cols + col;
      roles[at] = legend[win].role;
      detail[at] = { role: legend[win].role, confidence: +confidence.toFixed(2) };
    }
  }
  return { cols, rows, roles, detail, lowConfidence };
}
