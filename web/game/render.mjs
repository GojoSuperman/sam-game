/**
 * 성 렌더링 — 캔버스 프리미티브로만 그린다. 외부 이미지 자산 0개.
 *
 * 층 구성:
 *   tilemap.mjs  지면 (풀·흙·물·다리·돌바닥·벽·문) + autotile 경계
 *   props.mjs    소품 (나무·바위·통·가구) — 여러 칸을 쓰고 그림자가 있다
 *   여기         두 층을 오프스크린에 한 번 합쳐 캐시하고, 조명만 매 프레임 얹는다
 *
 * SPUM 에는 맵 export 가 없어 배경은 우리가 그린다.
 */

import { LAYOUT, STAGE, HUB } from './world.mjs';
import { buildTileMap, buildProps, paintTileMap, TILE } from './tilemap.mjs';
import { paintProps } from './props.mjs';

/** 조명원 — 매 프레임 흔들린다. 방 안 비율 좌표. */
export const LIGHTS = [
  { room: 'kitchen', x: 0.14, y: 0.30, r: 74, c: [255, 168, 84] },   // 화덕
  { room: 'gate', x: 0.80, y: 0.42, r: 58, c: [255, 176, 100] },     // 화톳불
  { room: 'archive', x: 0.66, y: 0.52, r: 42, c: [255, 214, 140] },  // 촛불
  { room: 'court', x: 0.50, y: 0.42, r: 46, c: [150, 200, 255] },    // 우물
];

const px = (r, fx, fy) => ({ x: r.x + r.w * fx, y: r.y + r.h * fy });

/** 정적 층(지면 + 소품)을 한 번만 그려 캐시한다 */
export function buildCastleLayer() {
  const cv = document.createElement('canvas');
  cv.width = STAGE.w; cv.height = STAGE.h;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const tiles = buildTileMap(LAYOUT, HUB);
  paintTileMap(ctx, tiles);

  // 벽이 방 안에 드리우는 그림자 — 타일만으로는 벽이 평평해 보인다
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  for (const r of Object.values(LAYOUT)) {
    ctx.fillRect(r.x, r.y, r.w, 4);
    ctx.fillRect(r.x, r.y, 3, r.h);
  }

  const props = buildProps(tiles, LAYOUT);
  paintProps(ctx, props);

  return cv;
}

/**
 * 조명과 시간대 색조. 낮이 흐르는 것이 화면으로 보이게 한다.
 * @param progress 0(아침) ~ 1(늦은 오후)
 */
export function drawLighting(ctx, t, progress) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const L of LIGHTS) {
    const r = LAYOUT[L.room];
    const p = px(r, L.x, L.y);
    const flick = 0.84 + Math.sin(t / 190 + L.x * 12) * 0.08 + Math.sin(t / 77 + L.y * 20) * 0.04;
    const rad = L.r * flick;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
    const [cr, cg, cb] = L.c;
    g.addColorStop(0, `rgba(${cr},${cg},${cb},${0.16 * flick})`);
    g.addColorStop(0.5, `rgba(${cr},${cg},${cb},${0.05 * flick})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // 시간대 — 아침의 서늘한 빛에서 늦은 오후의 노란 빛으로.
  // 주광 팔레트이므로 세게 덮으면 색이 죽는다. 얇게만 얹는다.
  const warm = Math.max(0, Math.min(1, progress));
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = `rgba(${Math.round(150 + warm * 90)},${Math.round(150 + warm * 50)},${Math.round(200 - warm * 90)},0.22)`;
  ctx.fillRect(0, 0, STAGE.w, STAGE.h);
  ctx.restore();

  // 화면 가장자리만 살짝 어둡게 — 시선을 성 안으로 모은다
  const v = ctx.createRadialGradient(STAGE.w / 2, STAGE.h / 2, STAGE.h * 0.46,
    STAGE.w / 2, STAGE.h / 2, STAGE.h * 0.92);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(10,14,20,0.42)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, STAGE.w, STAGE.h);
}

/** 발밑 그림자 — 인물이 바닥에 붙어 보이게 한다 */
export function drawShadow(ctx, x, y, w = 18) {
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.ellipse(x, y - 1, w / 2, w / 5, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** 걸을 때 흙먼지 */
export function drawDust(ctx, x, y, t) {
  for (let i = 0; i < 3; i += 1) {
    const ph = ((t / 260) + i / 3) % 1;
    ctx.fillStyle = `rgba(200,186,158,${0.24 * (1 - ph)})`;
    ctx.beginPath();
    ctx.arc(x - 4 + i * 3, y - ph * 5, 1.6 + ph * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function rr(ctx, x, y, w, h, rad, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  const k = Math.min(rad, w / 2, h / 2);
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.fill();
}

/** 캔버스 말풍선 — 낮에 인물들이 주고받는 짧은 말 */
export function drawBubble(ctx, x, y, text) {
  ctx.font = '10px "Noto Sans KR",sans-serif';
  const w = Math.min(150, ctx.measureText(text).width + 14);
  const h = 18;
  const bx = Math.max(4, Math.min(STAGE.w - w - 4, x - w / 2));
  const by = y - 56;
  rr(ctx, bx, by, w, h, 5, 'rgba(250,248,242,0.94)');
  ctx.strokeStyle = 'rgba(60,50,40,0.45)';
  ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
  ctx.beginPath();
  ctx.moveTo(x - 4, by + h); ctx.lineTo(x, by + h + 5); ctx.lineTo(x + 4, by + h);
  ctx.fillStyle = 'rgba(250,248,242,0.94)'; ctx.fill();
  ctx.fillStyle = '#2b2620';
  ctx.textAlign = 'center';
  ctx.fillText(text, bx + w / 2, by + 13);
}
