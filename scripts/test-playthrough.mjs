#!/usr/bin/env node
/**
 * 자동 플레이 — 의도한 추리 경로로 실제로 이길 수 있는지 확인한다.
 *
 *   node scripts/test-playthrough.mjs [판수]
 *
 * 이 테스트가 없으면 "규칙은 다 맞는데 풀 수는 없는 게임"을 만들 수 있다.
 * 전략 (플레이어가 할 수 있는 것만 쓴다 — 정답을 몰래 보지 않는다):
 *   1. 다섯 명에게 각자 여섯 시각의 행적을 묻는다 (본인 진술)
 *   2. 목격을 묻는다 (같은 방 사람)
 *   3. 판에서 같은 시각 두 장소가 적힌 인물 = 거짓 발각
 *   4. 서고에 있었다고 증언된 사람 중, 절도 시각에 서고에 있던 자를 첩자로 본다
 *   5. 그 시각 서고에 함께 있던 다른 사람을 목격자로 지목한다
 *
 * 예산: BEATS(18)회. 다 못 물어보는 것이 정상이므로, 예산을 넘으면
 * "정보 부족"으로 기록하고 그 비율을 본다.
 */
import { newSolvableCase, statementOf, judgeAccusation, confront, HOURS, RKO, BEATS } from '../web/game/case.mjs';

const CAST = ['kyle', 'mira', 'dorn', 'howell', 'ben'];
const N = Number(process.argv[2] || 500);

function play(kase, { budget = BEATS, reserve = 4 } = {}) {
  // 들이대기에도 턴이 든다. 질문 단계에서 예산을 다 쓰면 가를 수가 없다.
  const askBudget = Math.max(1, budget - reserve);
  // 판: board[id][hour] = Set(room)
  const board = {};
  const witnessedBy = {}; // board 에 목격으로 오른 항목의 출처
  for (const id of kase.cast) { board[id] = {}; witnessedBy[id] = {}; }
  const add = (id, hour, room, by) => {
    board[id][hour] ??= new Set();
    board[id][hour].add(room);
    witnessedBy[id][hour] ??= [];
    witnessedBy[id][hour].push({ room, by });
  };

  let spent = 0;
  const askOrder = [];
  // 절도 시각을 모르므로 모든 시각을 골고루 묻는다. 예산 18 = 5명 × 3.6시각
  for (const h of HOURS) for (const id of kase.cast) askOrder.push({ id, hour: h });

  for (const { id, hour } of askOrder) {
    if (spent >= askBudget) break;
    spent += 1;
    const st = statementOf(kase, id, hour);
    add(id, hour, st.room, id);                       // 본인 진술
    for (const w of st.saw) add(w, hour, st.room, id); // 목격 → 그 사람 위치도 오른다
  }

  // 거짓 발각: 같은 시각 두 장소
  const broken = new Set();
  for (const id of kase.cast) {
    for (const h of HOURS) {
      if ((board[id][h]?.size || 0) > 1) broken.add(id);
    }
  }

  // 서고에 있었다고 판에 오른 (인물, 시각) 쌍
  const archiveHits = [];
  for (const id of kase.cast) {
    for (const h of HOURS) {
      if (board[id][h]?.has('archive')) archiveHits.push({ id, hour: h });
    }
  }
  if (!archiveHits.length) return { verdict: 'no-info', spent, broken };

  // 첩자 추론: 서고에 있었는데 그 시각 진술이 어긋나거나, 남이 봤다고 한 사람
  // 플레이어가 쓸 수 있는 신호는 "남이 서고에서 봤다고 증언한 사람"이다
  const bySomeoneElse = archiveHits.filter(({ id, hour }) =>
    (witnessedBy[id][hour] || []).some((w) => w.by !== id));

  const candidates = bySomeoneElse.length ? bySomeoneElse : archiveHits;
  // 남이 서고에서 봤는데 본인은 다른 곳이라고 주장한 (인물, 시각) = 모순 후보
  const suspects = candidates.filter((c) => {
    const selfClaims = (witnessedBy[c.id][c.hour] || []).filter((w) => w.by === c.id).map((w) => w.room);
    return selfClaims.length && !selfClaims.includes('archive');
  });

  // 여기서 첩자와 공범이 똑같이 보인다. 들이대서 가른다 —
  // 공범은 실토하며 시킨 사람을 대고, 첩자는 부인한다.
  let guess = null;
  for (const c of (suspects.length ? suspects : candidates)) {
    if (spent >= budget) break;
    spent += 1;
    const r = confront(kase, c.id, c.hour);
    if (r.kind === 'confess') {
      // 실토가 첩자를 특정한다. 시각도 그 시각이다.
      guess = { id: r.names, hour: c.hour, via: 'confession' };
      broken.add(c.id);
      break;
    }
    if (r.kind === 'deny' && !guess) guess = { ...c, via: 'deny' };
  }
  guess ??= (suspects[0] || candidates[0]);

  // 목격자: 같은 시각 서고에 있던 다른 사람 (본인이 서고라고 진술한 사람)
  const witnesses = kase.cast.filter((id) => id !== guess.id
    && (witnessedBy[id][guess.hour] || []).some((w) => w.by === id && w.room === 'archive'));
  if (!witnesses.length) return { verdict: 'no-witness', spent, broken, guess };

  const j = judgeAccusation(kase, { spy: guess.id, hour: guess.hour, witness: witnesses[0] }, broken);
  return { verdict: j.win ? 'win' : 'lose', spent, broken, guess, judge: j, witness: witnesses[0], via: guess.via };
}

const tally = {};
const viaTally = {};
const loseDetail = [];
for (let i = 1; i <= N; i += 1) {
  const kase = newSolvableCase(CAST, { seed: i });
  const r = play(kase);
  tally[r.verdict] = (tally[r.verdict] || 0) + 1;
  if (r.via) viaTally[r.via] = (viaTally[r.via] || 0) + 1;
  if (r.verdict === 'lose' && loseDetail.length < 5) {
    loseDetail.push({ seed: i, guess: r.guess, truth: { spy: kase.spy, hour: kase.theftHour }, judge: r.judge });
  }
}

console.log(`\n=== 자동 플레이 ${N}판 (예산 ${BEATS}회) ===\n`);
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  const pct = ((v / N) * 100).toFixed(1);
  console.log(`  ${k.padEnd(12)} ${String(v).padStart(4)}판  ${pct}%`);
}
console.log(`\n  첩자 특정 경로: ${Object.entries(viaTally).map(([k, v]) => `${k}=${v}`).join(' · ') || '없음'}`);
if (loseDetail.length) {
  console.log('\n  오답 예시:');
  for (const d of loseDetail) {
    console.log(`    seed ${d.seed}: 추측 ${d.guess.id}/${d.guess.hour} vs 진실 ${d.truth.spy}/${d.truth.hour}`
      + `  (spy=${d.judge.okSpy} hour=${d.judge.okHour} wit=${d.judge.okWitness}/${d.judge.witnessReason})`);
  }
}

// 예산 무제한 — 게임이 논리적으로 풀리는지의 증명
let fullWin = 0; let fullN = 200;
const fullFail = [];
for (let i = 1; i <= fullN; i += 1) {
  const kase = newSolvableCase(CAST, { seed: i });
  const r = play(kase, { budget: Infinity, reserve: 0 });
  if (r.verdict === 'win') fullWin += 1;
  else if (fullFail.length < 6) fullFail.push({ seed: i, verdict: r.verdict, via: r.via, guess: r.guess,
    truth: { spy: kase.spy, hour: kase.theftHour, acc: kase.accomplice } });
}
console.log(`\n  예산 무제한 승률: ${fullWin}/${fullN} = ${((fullWin / fullN) * 100).toFixed(1)}%`);
for (const f of fullFail) {
  console.log(`    seed ${f.seed}: ${f.verdict} via=${f.via} 추측=${f.guess?.id}/${f.guess?.hour}`
    + ` 진실=${f.truth.spy}/${f.truth.hour} 공범=${f.truth.acc}`);
}
console.log(fullWin === fullN
  ? '  \x1b[32m모든 사건이 완전 정보로 풀린다 — 게임이 논리적으로 성립한다\x1b[0m'
  : `  \x1b[31m완전 정보로도 못 푸는 사건이 ${fullN - fullWin}건 있다 — 설계 결함\x1b[0m`);
console.log('');
process.exit(fullWin === fullN ? 0 : 1);
