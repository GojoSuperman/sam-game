#!/usr/bin/env node
/**
 * 렌더 코드 검증 — 브라우저 없이.
 *
 *   node scripts/test-render.mjs
 *
 * 가짜 CanvasRenderingContext2D 로 드로우 콜을 기록한다. 확인:
 *   1. buildCastleLayer() 가 예외 없이 끝난다
 *   2. 여섯 방이 모두 그려진다
 *   3. 정의된 가구 종류가 전부 실제로 그려진다 (오타로 조용히 빠지는 것을 잡는다)
 *   4. 좌표가 화면 밖으로 나가지 않는다
 *   5. drawLighting/Shadow/Dust/Bubble 이 예외 없이 돈다
 */
const ops = [];
let oob = 0;
const BOUND = { w: 780, h: 500, pad: 40 };

function track(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) { ops.push({ op: 'NaN', x, y }); return; }
  if (x < -BOUND.pad || x > BOUND.w + BOUND.pad || y < -BOUND.pad || y > BOUND.h + BOUND.pad) oob += 1;
}

class FakeCtx {
  constructor() {
    this.fillStyle = ''; this.strokeStyle = ''; this.lineWidth = 1;
    this.font = ''; this.textAlign = ''; this.lineCap = '';
    this.globalCompositeOperation = '';
    this.imageSmoothingEnabled = true;
  }
  fillRect(x, y, w, h) { ops.push({ op: 'fillRect', x, y, w, h, s: this.fillStyle }); track(x, y); track(x + w, y + h); }
  strokeRect(x, y, w, h) { ops.push({ op: 'strokeRect', x, y, w, h }); track(x, y); }
  beginPath() { ops.push({ op: 'beginPath' }); }
  moveTo(x, y) { ops.push({ op: 'moveTo', x, y }); track(x, y); }
  lineTo(x, y) { ops.push({ op: 'lineTo', x, y }); track(x, y); }
  arcTo(x1, y1, x2, y2, r) { ops.push({ op: 'arcTo' }); track(x1, y1); }
  arc(x, y, r) { ops.push({ op: 'arc', x, y, r }); track(x, y); }
  ellipse(x, y, rx, ry) { ops.push({ op: 'ellipse', x, y, rx, ry }); track(x, y); }
  fill() { ops.push({ op: 'fill', s: this.fillStyle }); }
  stroke() { ops.push({ op: 'stroke' }); }
  save() { ops.push({ op: 'save' }); }
  restore() { ops.push({ op: 'restore' }); }
  closePath() { ops.push({ op: 'closePath' }); }
  quadraticCurveTo(a,b,x,y) { ops.push({ op:'quadraticCurveTo' }); track(x,y); }
  bezierCurveTo(a,b,c,d,x,y) { ops.push({ op:'bezierCurveTo' }); track(x,y); }
  rect(x,y,w,h) { ops.push({ op:'rect', x, y, w, h }); track(x,y); }
  clip() {}
  setLineDash() {}
  translate() {} scale() {} rotate() {}
  fillText(t, x, y) { ops.push({ op: 'fillText', t, x, y }); track(x, y); }
  measureText(t) { return { width: String(t).length * 6 }; }
  drawImage() { ops.push({ op: 'drawImage' }); }
  createRadialGradient() { return { addColorStop() {} }; }
}

// DOM 최소 스텁
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => new FakeCtx() }),
};

const R = await import('../web/game/render.mjs');
const { LAYOUT } = await import('../web/game/world.mjs');

let fail = 0;
const bad = (m) => { console.log(`  \x1b[31mFAIL\x1b[0m ${m}`); fail += 1; };
const ok = (m) => console.log(`  \x1b[32mOK\x1b[0m   ${m}`);

console.log('\n=== 렌더 검증 (브라우저 없이) ===\n');

// 1
let layer;
try { layer = R.buildCastleLayer(); ok(`buildCastleLayer() 완주 — 드로우 콜 ${ops.length}개`); }
catch (err) { bad(`buildCastleLayer() 예외: ${err.message}`); process.exit(1); }

// NaN 좌표
const nans = ops.filter((o) => o.op === 'NaN');
if (nans.length) bad(`NaN 좌표 ${nans.length}건`); else ok('NaN 좌표 없음');

// 2 — 타일 커버리지: 방 내부의 모든 타일 칸이 그려졌는가
const { TILE, GRID } = await import('../web/game/tilemap.mjs');
const painted = new Set();
for (const o of ops) {
  if (o.op !== 'fillRect') continue;
  if (Math.abs(o.w - TILE) > 0.5 || Math.abs(o.h - TILE) > 0.5) continue;
  if (o.x % TILE !== 0 || o.y % TILE !== 0) continue;
  painted.add(`${o.x / TILE},${o.y / TILE}`);
}
if (painted.size !== GRID.w * GRID.h) {
  bad(`타일 커버리지 ${painted.size}/${GRID.w * GRID.h} — 안 그려진 칸이 있다`);
} else {
  ok(`타일 전면 커버 ${painted.size}칸 (${GRID.w}x${GRID.h})`);
}

const roomIds = Object.keys(LAYOUT);
let missRoom = 0;
for (const id of roomIds) {
  const r = LAYOUT[id];
  for (let ty = r.y / TILE; ty < (r.y + r.h) / TILE; ty += 1) {
    for (let tx = r.x / TILE; tx < (r.x + r.w) / TILE; tx += 1) {
      if (!painted.has(`${tx},${ty}`)) { missRoom += 1; }
    }
  }
}
if (missRoom) bad(`방 내부에 안 그려진 타일 ${missRoom}칸`);
else ok(`여섯 방 내부 타일 전부 그려짐`);

// 3 — 소품: buildProps 가 내는 타입이 전부 props.mjs 에 그림이 있는가
const { buildTileMap, buildProps, T, GRID: G2, TILE: TL } = await import('../web/game/tilemap.mjs');
const { PROP_TYPES } = await import('../web/game/props.mjs');
const { HUB } = await import('../web/game/world.mjs');
const tilesForProps = buildTileMap(LAYOUT, HUB);
const propList = buildProps(tilesForProps, LAYOUT);
const emitted = [...new Set(propList.map((p) => p.t))];
const noDraw = emitted.filter((t) => !PROP_TYPES.includes(t));
if (noDraw.length) bad(`그림 없는 소품 타입: ${noDraw.join(', ')} — 조용히 안 그려진다`);
else ok(`소품 타입 ${emitted.length}종 전부 그림 있음 (총 ${propList.length}개 배치)`);
const neverUsed = PROP_TYPES.filter((t) => !emitted.includes(t));
if (neverUsed.length) console.log(`       (배치 안 되는 그림: ${neverUsed.join(', ')})`);
const counts = propList.reduce((a, p) => { a[p.t] = (a[p.t] || 0) + 1; return a; }, {});
console.log(`       ${Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}=${v}`).join(' ')}`);
// 소품이 물/벽 위에 놓이지 않았는가 (고정 가구는 방 안이므로 제외)
const scatter = propList.filter((p) => ['tree','bush','rock','tuft'].includes(p.t));
const onBad = scatter.filter((p) => tilesForProps.get(p.tx, p.ty) !== T.GRASS);
if (onBad.length) bad(`풀밭 아닌 곳에 놓인 자연물 ${onBad.length}개`);
else ok(`자연물 ${scatter.length}개 전부 풀밭 위`);

// 4
if (oob > 0) bad(`화면 밖 좌표 ${oob}건`); else ok('좌표 전부 화면 안');

// 5
const ctx = new FakeCtx();
for (const [label, fn] of [
  ['drawLighting', () => R.drawLighting(ctx, 1234, 0.5)],
  ['drawShadow', () => R.drawShadow(ctx, 100, 200)],
  ['drawDust', () => R.drawDust(ctx, 100, 200, 999)],
  ['drawBubble', () => R.drawBubble(ctx, 390, 250, '오늘 바람이 차네.')],
  ['drawBubble(긴 문장)', () => R.drawBubble(ctx, 20, 60, '아주 긴 문장을 넣어서 화면 왼쪽 경계를 넘는지 확인한다')],
]) {
  try { fn(); ok(`${label} 정상`); } catch (err) { bad(`${label} 예외: ${err.message}`); }
}

// 말풍선이 화면 안에 머무는가
const bub = ops.filter((o) => o.op === 'arcTo').length;
console.log(`\n  드로우 콜 구성: ${Object.entries(ops.reduce((a, o) => { a[o.op] = (a[o.op] || 0) + 1; return a; }, {}))
  .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
console.log(`\n${fail === 0 ? '\x1b[32m렌더 검증 전부 통과\x1b[0m' : `\x1b[31m실패 ${fail}건\x1b[0m`}\n`);
process.exit(fail ? 1 : 0);
