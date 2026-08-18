/**
 * 소품 그리기 — 나무·바위·통·울타리·건물 안 가구.
 *
 * 앞선 판의 소품은 타일 한 칸 안에 그려서 납작했다. 레퍼런스 화면의 나무는
 * 여러 칸을 쓰고 아래에 그림자가 있어 서 있는 물체로 읽힌다. 그 차이를 맞춘다.
 *
 * 좌표는 타일 단위로 받고 픽셀로 환산한다.
 */
import { TILE } from './tilemap.mjs';

function h2(x, y, s = 0) {
  let n = (x * 374761393 + y * 668265263 + s * 2246822519) >>> 0;
  n = ((n ^ (n >> 13)) * 1274126177) >>> 0;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
}

/** 바닥 그림자 — 소품이 지면에 붙어 보이게 */
function shadow(ctx, cx, by, w, h = 4) {
  ctx.fillStyle = 'rgba(0,0,0,.26)';
  ctx.beginPath();
  ctx.ellipse(cx, by, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
}

function blob(ctx, cx, cy, rx, ry, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** 나무 — 2×3칸. 수관을 세 겹으로 얹어 부피를 만든다. */
function tree(ctx, x, y, v) {
  const cx = x + TILE;          // 2칸 폭의 중심
  const by = y + TILE * 3 - 2;  // 밑동
  const tall = v > 0.55;
  const th = tall ? TILE * 3 : TILE * 2.4;

  shadow(ctx, cx, by, TILE * 1.5, 6);
  // 줄기
  ctx.fillStyle = '#5d4227';
  ctx.fillRect(cx - 2, by - th * 0.34, 4, th * 0.34);
  ctx.fillStyle = '#6e5030';
  ctx.fillRect(cx - 2, by - th * 0.34, 2, th * 0.34);

  // 수관 — 어두운 바탕 → 중간 → 밝은 하이라이트
  const topY = by - th * 0.34 - th * 0.30;
  blob(ctx, cx, topY + 3, TILE * 0.95, TILE * 0.72, '#2c5528');
  blob(ctx, cx - 4, topY, TILE * 0.66, TILE * 0.55, '#386b32');
  blob(ctx, cx + 5, topY + 2, TILE * 0.58, TILE * 0.48, '#33622e');
  blob(ctx, cx - 3, topY - 4, TILE * 0.40, TILE * 0.32, '#4a8a41');
  if (v > 0.7) blob(ctx, cx + 3, topY - 5, TILE * 0.26, TILE * 0.22, '#57a24c');
}

function bush(ctx, x, y, v) {
  const cx = x + TILE / 2; const by = y + TILE - 2;
  shadow(ctx, cx, by, TILE * 0.8, 4);
  blob(ctx, cx, by - 4, 7, 5.5, '#2f5a2b');
  blob(ctx, cx - 2, by - 6, 5, 4, '#3d6f36');
  blob(ctx, cx + 2, by - 6, 4, 3.2, '#478044');
  if (v < 0.075) { // 열매
    ctx.fillStyle = '#c8503f';
    ctx.fillRect(cx - 1, by - 7, 2, 2);
  }
}

function rock(ctx, x, y, v) {
  const cx = x + TILE / 2; const by = y + TILE - 3;
  shadow(ctx, cx, by + 1, TILE * 0.7, 3);
  blob(ctx, cx, by - 3, 6, 4.5, '#7c8189');
  blob(ctx, cx - 1, by - 4.5, 4, 3, '#8f949c');
  ctx.fillStyle = 'rgba(255,255,255,.14)';
  ctx.fillRect(cx - 3, by - 6, 3, 1);
}

function tuft(ctx, x, y, v) {
  const cx = x + 3 + ((v * 9) | 0);
  const by = y + TILE - 3;
  ctx.strokeStyle = '#63a055';
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.moveTo(cx + i * 2, by);
    ctx.lineTo(cx + i * 2 + (i - 1), by - 4 - (i === 1 ? 2 : 0));
    ctx.stroke();
  }
}

function fence(ctx, x, y) {
  const by = y + TILE - 2;
  ctx.fillStyle = '#8a6238';
  ctx.fillRect(x + 2, by - 10, 2, 10);
  ctx.fillRect(x + 12, by - 10, 2, 10);
  ctx.fillStyle = '#9c7043';
  ctx.fillRect(x, by - 8, TILE, 2);
  ctx.fillRect(x, by - 4, TILE, 2);
}

function barrel(ctx, x, y) {
  const cx = x + TILE / 2; const by = y + TILE - 2;
  shadow(ctx, cx, by, 12, 4);
  ctx.fillStyle = '#7d5730';
  ctx.fillRect(cx - 5, by - 13, 10, 13);
  ctx.fillStyle = '#8d6538';
  ctx.fillRect(cx - 5, by - 13, 4, 13);
  ctx.fillStyle = '#5a4a3a';
  ctx.fillRect(cx - 5, by - 10, 10, 2);
  ctx.fillRect(cx - 5, by - 5, 10, 2);
  ctx.fillStyle = '#96703f';
  ctx.beginPath(); ctx.ellipse(cx, by - 13, 5, 2, 0, 0, Math.PI * 2); ctx.fill();
}

function crate(ctx, x, y) {
  const cx = x + TILE / 2; const by = y + TILE - 2;
  shadow(ctx, cx, by, 13, 4);
  ctx.fillStyle = '#8a6438';
  ctx.fillRect(cx - 6, by - 12, 12, 12);
  ctx.strokeStyle = '#6b4c28';
  ctx.strokeRect(cx - 5.5, by - 11.5, 11, 11);
  ctx.beginPath();
  ctx.moveTo(cx - 5, by - 11); ctx.lineTo(cx + 5, by - 1);
  ctx.moveTo(cx + 5, by - 11); ctx.lineTo(cx - 5, by - 1);
  ctx.stroke();
}

function well(ctx, x, y) {
  const cx = x + TILE; const by = y + TILE * 2 - 2;
  shadow(ctx, cx, by, TILE * 1.7, 6);
  ctx.fillStyle = '#6d737b';
  ctx.beginPath(); ctx.ellipse(cx, by - 5, 15, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1b2530';
  ctx.beginPath(); ctx.ellipse(cx, by - 6, 10, 5.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8a5f36';   // 기둥과 지붕
  ctx.fillRect(cx - 13, by - 26, 3, 20);
  ctx.fillRect(cx + 10, by - 26, 3, 20);
  ctx.fillStyle = '#9c6b3d';
  ctx.beginPath();
  ctx.moveTo(cx - 17, by - 25); ctx.lineTo(cx, by - 34); ctx.lineTo(cx + 17, by - 25);
  ctx.closePath(); ctx.fill();
}

function hearth(ctx, x, y) {
  const w = TILE * 2.4; const h = TILE * 1.6;
  ctx.fillStyle = '#4d4038';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#2b2320';
  ctx.fillRect(x + w * 0.2, y + h * 0.35, w * 0.6, h * 0.6);
  ctx.fillStyle = '#e0812f';
  ctx.beginPath(); ctx.ellipse(x + w / 2, y + h * 0.82, w * 0.20, h * 0.16, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffc25c';
  ctx.beginPath(); ctx.ellipse(x + w / 2, y + h * 0.84, w * 0.11, h * 0.09, 0, 0, Math.PI * 2); ctx.fill();
}

function shelf(ctx, x, y) {
  const w = TILE * 2.6; const h = TILE * 1.5;
  ctx.fillStyle = '#5a4227';
  ctx.fillRect(x, y, w, h);
  for (let i = 0; i < Math.floor(w / 5); i += 1) {
    const bh = h * (0.42 + ((i * 7) % 5) / 11);
    ctx.fillStyle = ['#8f5d43', '#4f6d8f', '#8f8449', '#7a4a63', '#5f8f5a'][i % 5];
    ctx.fillRect(x + 2 + i * 5, y + h - bh - 2, 4, bh);
  }
  ctx.fillStyle = '#3f2e1b';
  ctx.fillRect(x, y + h - 2, w, 2);
}

function bed(ctx, x, y) {
  const w = TILE * 2.2; const h = TILE * 3;
  ctx.fillStyle = '#4a3a2c';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#cfd4de';
  ctx.fillRect(x + 2, y + 2, w - 4, h * 0.24);
  ctx.fillStyle = '#4a6d8f';
  ctx.fillRect(x + 2, y + h * 0.30, w - 4, h * 0.64);
  ctx.fillStyle = '#5b80a4';
  ctx.fillRect(x + 2, y + h * 0.30, w - 4, 3);
}

function table(ctx, x, y) {
  const w = TILE * 2.6; const h = TILE * 1.4;
  ctx.fillStyle = '#7a5530';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#8d6437';
  ctx.fillRect(x + 1, y + 1, w - 2, 4);
  ctx.fillStyle = '#c9c2ae';   // 그릇
  ctx.beginPath(); ctx.ellipse(x + w * 0.3, y + h * 0.55, 4, 2.5, 0, 0, Math.PI * 2); ctx.fill();
}

function desk(ctx, x, y) {
  const w = TILE * 2.2; const h = TILE * 1.1;
  ctx.fillStyle = '#6e4d2c';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#e8e2cf';   // 서류
  ctx.fillRect(x + 4, y + 3, 9, 6);
  ctx.strokeStyle = '#b8ae95';
  ctx.strokeRect(x + 4.5, y + 3.5, 8, 5);
}

function rack(ctx, x, y) {
  ctx.fillStyle = '#4a4f57';
  ctx.fillRect(x + 2, y, 3, TILE * 2.6);
  ctx.strokeStyle = '#9aa2ad';   // 창날
  ctx.beginPath(); ctx.moveTo(x + 3.5, y); ctx.lineTo(x + 3.5, y - 5); ctx.stroke();
  ctx.fillStyle = '#c6ccd4';
  ctx.beginPath(); ctx.moveTo(x + 1, y - 5); ctx.lineTo(x + 3.5, y - 10); ctx.lineTo(x + 6, y - 5); ctx.closePath(); ctx.fill();
}

function brazier(ctx, x, y) {
  const cx = x + TILE / 2; const by = y + TILE;
  shadow(ctx, cx, by, 14, 5);
  ctx.fillStyle = '#3e4148';
  ctx.fillRect(cx - 2, by - 10, 4, 10);
  ctx.fillStyle = '#54585f';
  ctx.beginPath(); ctx.ellipse(cx, by - 11, 8, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e08a2e';
  ctx.beginPath(); ctx.ellipse(cx, by - 12, 5.5, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffd071';
  ctx.beginPath(); ctx.ellipse(cx, by - 13, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
}

function hay(ctx, x, y) {
  const w = TILE * 2.4; const cx = x + w / 2; const by = y + TILE * 2.2;
  shadow(ctx, cx, by, w, 6);
  ctx.fillStyle = '#b39a3f';
  ctx.beginPath(); ctx.ellipse(cx, by - 9, w / 2, 11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#8e7a2e';
  for (let i = 0; i < 7; i += 1) {
    ctx.beginPath();
    ctx.moveTo(cx - w / 2 + 4 + i * (w / 8), by - 2);
    ctx.lineTo(cx - w / 2 + 2 + i * (w / 8), by - 17);
    ctx.stroke();
  }
  ctx.fillStyle = '#c9b055';
  ctx.beginPath(); ctx.ellipse(cx - 3, by - 13, w / 4, 5, 0, 0, Math.PI * 2); ctx.fill();
}

function stall(ctx, x, y) {
  const w = TILE * 3; const h = TILE * 2.2;
  ctx.fillStyle = '#5c4527';
  ctx.fillRect(x, y, w, 3);
  ctx.strokeStyle = '#6d5230';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 3; i += 1) {
    ctx.beginPath(); ctx.moveTo(x + (w / 3) * i, y); ctx.lineTo(x + (w / 3) * i, y + h); ctx.stroke();
  }
  ctx.lineWidth = 1;
}

function woodpile(ctx, x, y) {
  const w = TILE * 2; const h = TILE * 1.2;
  shadow(ctx, x + w / 2, y + h + 1, w, 4);
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      ctx.fillStyle = (r + c) % 2 ? '#7d5c34' : '#8d6a3d';
      ctx.fillRect(x + c * (w / 4), y + r * (h / 3), w / 4 - 1, h / 3 - 1);
      ctx.fillStyle = '#c9b48a';
      ctx.fillRect(x + c * (w / 4) + 1, y + r * (h / 3) + 1, 2, 2);
    }
  }
}

function bucket(ctx, x, y) {
  const cx = x + TILE / 2; const by = y + TILE - 2;
  shadow(ctx, cx, by, 9, 3);
  ctx.fillStyle = '#75563a';
  ctx.fillRect(cx - 4, by - 8, 8, 8);
  ctx.fillStyle = '#3f7fc0';
  ctx.fillRect(cx - 3, by - 7, 6, 2);
}

function pot(ctx, x, y) {
  const cx = x + TILE / 2; const by = y + TILE - 2;
  shadow(ctx, cx, by, 11, 4);
  ctx.fillStyle = '#4a4d54';
  ctx.beginPath(); ctx.ellipse(cx, by - 4, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5c6068';
  ctx.beginPath(); ctx.ellipse(cx, by - 6, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
}

function chest(ctx, x, y) {
  const cx = x + TILE / 2; const by = y + TILE + 4;
  shadow(ctx, cx, by, 16, 4);
  ctx.fillStyle = '#6b4a29';
  ctx.fillRect(cx - 8, by - 11, 16, 11);
  ctx.fillStyle = '#7d5931';
  ctx.fillRect(cx - 8, by - 11, 16, 4);
  ctx.fillStyle = '#c8a35a';
  ctx.fillRect(cx - 2, by - 8, 4, 4);
}

function bench(ctx, x, y) {
  const w = TILE * 2; const by = y + TILE - 2;
  shadow(ctx, x + w / 2, by + 1, w, 4);
  ctx.fillStyle = '#7a5530';
  ctx.fillRect(x, by - 7, w, 4);
  ctx.fillStyle = '#5f4225';
  ctx.fillRect(x + 2, by - 3, 3, 3);
  ctx.fillRect(x + w - 5, by - 3, 3, 3);
}

function candle(ctx, x, y) {
  const cx = x + TILE / 2; const by = y + TILE - 4;
  ctx.fillStyle = '#d8cfae';
  ctx.fillRect(cx - 1, by - 7, 2, 7);
  ctx.fillStyle = '#ffd884';
  ctx.beginPath(); ctx.ellipse(cx, by - 9, 2, 3, 0, 0, Math.PI * 2); ctx.fill();
}

const DRAW = {
  tree, bush, rock, tuft, fence, barrel, crate, well, hearth, shelf, bed,
  table, desk, rack, brazier, hay, stall, woodpile, bucket, pot, chest, bench, candle,
};

/** 소품 목록을 그린다. props 는 ty 로 정렬돼 있어 아래쪽이 나중에 그려진다. */
export function paintProps(ctx, props) {
  for (const p of props) {
    const fn = DRAW[p.t];
    if (!fn) continue;
    fn(ctx, p.tx * TILE, p.ty * TILE, p.v ?? h2(p.tx, p.ty, 1));
  }
}

export const PROP_TYPES = Object.keys(DRAW);
