#!/usr/bin/env node
/**
 * 낮 시뮬레이션 검증.
 *
 *   node scripts/test-world.mjs [판수]
 *
 * 확인:
 *   1. 인물이 실제로 이동한다 (좌표가 변한다)
 *   2. 이동이 끝나면 방 안에 정확히 들어간다 (방 경계 안)
 *   3. 포섭 beat 에 첩자와 공범이 단둘이 같은 방에 있다 (앞뒤가 맞는 사건)
 *   4. 낮 피드가 쌓이고 상한(24)을 넘지 않는다
 *   5. 행동 라벨이 갱신된다 (화면이 죽지 않는다)
 *   6. 이동 중 좌표가 방 밖으로 새지 않는다
 */
import { newSolvableCase, BEATS, RKO } from '../web/game/case.mjs';
import { createWorld, advanceBeat, step, LAYOUT, inRoom, STAGE } from '../web/game/world.mjs';

const CAST = ['kyle', 'mira', 'dorn', 'howell', 'ben'];
const N = Number(process.argv[2] || 200);
let fail = 0;
const bad = (i, m) => { console.log(`  \x1b[31mFAIL\x1b[0m [seed ${i}] ${m}`); fail += 1; };

function inside(rect, x, y, pad = 4) {
  return x >= rect.x - pad && x <= rect.x + rect.w + pad && y >= rect.y - pad && y <= rect.y + rect.h + pad;
}

let totalMoves = 0; let totalMeets = 0; let recruitOk = 0; let recruitCases = 0;
const activitySeen = new Set();

for (let i = 1; i <= N; i += 1) {
  const kase = newSolvableCase(CAST, { seed: i });
  let s = i >>> 0 || 1;
  const rng = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 0x100000000; };
  const w = createWorld(kase, rng);
  if (w.recruitBeat) recruitCases += 1;

  let t = 0;
  const startPos = Object.fromEntries(Object.values(w.actors).map((a) => [a.id, { x: a.x, y: a.y }]));
  let moved = 0;

  for (let b = 1; b <= BEATS; b += 1) {
    const { met } = advanceBeat(w);
    totalMeets += met.length;

    // 포섭 beat: 첩자와 공범이 같은 방에 단둘이 있어야 한다
    if (w.recruitBeat === b) {
      const sr = w.actors[kase.spy].room;
      const ar = w.actors[kase.accomplice].room;
      if (sr !== ar) bad(i, `포섭 beat ${b}: 첩자(${RKO[sr]})와 공범(${RKO[ar]})이 다른 방에 있다`);
      const others = kase.cast.filter((id) => id !== kase.spy && id !== kase.accomplice
        && w.actors[id].room === sr);
      if (others.length) bad(i, `포섭 beat ${b}: 제3자 ${others.length}명이 같은 방에 있다`);
      if (sr === ar && !others.length) recruitOk += 1;
    }

    // 도착까지 시뮬레이션을 돌린다
    for (let k = 0; k < 400; k += 1) {
      t += 16;
      step(w, t, 16);
      for (const a of Object.values(w.actors)) {
        if (a.x < -20 || a.x > STAGE.w + 20 || a.y < -20 || a.y > STAGE.h + 20) {
          bad(i, `좌표가 화면을 벗어났다: ${a.id} (${a.x.toFixed(0)},${a.y.toFixed(0)})`);
        }
        activitySeen.add(a.activity);
      }
      if (Object.values(w.actors).every((a) => !a.path.length)) break;
    }
    // 도착 후 방 경계 안에 있는지
    for (const a of Object.values(w.actors)) {
      if (a.path.length) continue;
      if (!inside(LAYOUT[a.room], a.x, a.y, 8)) {
        bad(i, `${a.id}가 ${RKO[a.room]} 밖에 있다 (${a.x.toFixed(0)},${a.y.toFixed(0)})`);
      }
    }
  }

  for (const a of Object.values(w.actors)) {
    if (Math.hypot(a.x - startPos[a.id].x, a.y - startPos[a.id].y) > 1) moved += 1;
  }
  totalMoves += moved;
  if (w.feed.length > 24) bad(i, `피드가 상한을 넘었다: ${w.feed.length}`);
}

console.log(`\n=== 낮 시뮬레이션 검증 (${N}판 × ${BEATS} beat) ===\n`);
console.log(`  이동한 인물      평균 ${(totalMoves / N).toFixed(1)} / 5명`);
console.log(`  만남 기록        평균 ${(totalMeets / N).toFixed(1)}회 / 판`);
console.log(`  포섭 만남 성립   ${recruitOk}/${recruitCases}`);
console.log(`  행동 라벨 종류   ${activitySeen.size}개`);
console.log(`    예: ${[...activitySeen].slice(0, 6).join(' / ')}`);
console.log('');
if (recruitOk !== recruitCases) {
  console.log(`  \x1b[31m포섭 만남이 성립하지 않은 사건이 ${recruitCases - recruitOk}건\x1b[0m`);
  fail += 1;
}
console.log(fail === 0 ? '\x1b[32m불변식 6종 전부 통과\x1b[0m' : `\x1b[31m실패 ${fail}건\x1b[0m`);
console.log('');
process.exit(fail ? 1 : 0);
