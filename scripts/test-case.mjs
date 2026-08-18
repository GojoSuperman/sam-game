#!/usr/bin/env node
/**
 * 사건 생성기 검증. 추리가 성립하는지 논리로 확인한다.
 *
 *   node scripts/test-case.mjs [횟수]
 *
 * 확인할 불변식:
 *   1. 절도 시각에 첩자는 서고에 있다
 *   2. 목격자가 최소 1명 있다 (없으면 풀 수 없는 사건)
 *   3. 공범이 있고, 공범의 실제 위치는 심어진 방과 다르다 (= 구멍이 반드시 남는다)
 *   4. 공범에게 다른 각도로 물으면 어긋난다 (같은 시각 두 방)
 *   5. 첩자의 알리바이 방은 서고가 아니다
 *   6. 같은 시드는 같은 사건을 만든다 (재현성)
 */
import { newSolvableCase, newCase, statementOf, honestKnowledge, judgeAccusation, HOURS, RKO } from '../web/game/case.mjs';

const CAST = ['kyle', 'mira', 'dorn', 'howell', 'ben'];
const N = Number(process.argv[2] || 2000);

let fail = 0;
const bad = (i, m) => { console.log(`  \x1b[31mFAIL\x1b[0m [seed ${i}] ${m}`); fail += 1; };

for (let i = 1; i <= N; i += 1) {
  let k;
  try { k = newSolvableCase(CAST, { seed: i }); }
  catch (e) { bad(i, e.message); continue; }

  // 1
  if (k.truth[k.spy][k.theftHour] !== 'archive') bad(i, '첩자가 절도 시각에 서고에 없다');
  // 2
  if (!k.solution.witness.length) bad(i, '목격자가 없다');
  // 5
  if (k.fakeRoom === 'archive') bad(i, '알리바이 방이 서고다 (거짓말이 아니게 된다)');
  // 3
  if (!k.accomplice || !k.plant) { bad(i, '공범/심어진 말이 없다'); continue; }
  if (k.plant.actualRoom === k.plant.room) bad(i, '공범의 실제 위치가 심어진 방과 같다 — 구멍이 안 남는다');
  if (k.accomplice === k.spy) bad(i, '공범이 첩자 자신이다');

  // 4 — 두 각도의 답이 실제로 어긋나는지
  const asWitness = statementOf(k, k.accomplice, k.plant.hour);   // "누구를 봤소?"
  const asSelf = honestKnowledge(k, k.accomplice, k.plant.hour);  // "당신은 어디 있었소?"
  if (!asWitness.lie) bad(i, '공범의 목격 진술이 거짓으로 표시되지 않았다');
  if (asWitness.room === asSelf.room) bad(i, `공범 진술이 어긋나지 않는다 (${RKO[asWitness.room]})`);

  if (k.solution.witness.includes(k.accomplice)) bad(i, '공범이 정직한 목격자 목록에 들어갔다');
  if (k.solution.witness.includes(k.spy)) bad(i, '첩자가 자기 목격자 목록에 들어갔다');

  // 목격자는 서고에 있던 사람이므로, 그가 첩자를 봤다고 정직하게 말할 수 있어야 한다
  for (const w of k.solution.witness) {
    const st = statementOf(k, w, k.theftHour);
    if (st.lie) continue; // 목격자가 공범이면 거짓을 말한다 — 그건 정상
    if (st.room !== 'archive') bad(i, '목격자의 정직한 진술이 서고가 아니다');
    if (!st.saw.includes(k.spy)) bad(i, '목격자가 첩자를 봤다고 말하지 못한다');
  }
}

// 7 지목 판정
{
  const k = newSolvableCase(CAST, { seed: 777 });
  const sol = k.solution;
  const good = judgeAccusation(k, { spy: sol.spy, hour: sol.hour, witness: sol.witness[0] });
  if (!good.win) bad(777, '정답 삼중조가 승리로 판정되지 않았다');
  const wrongHour = judgeAccusation(k, { spy: sol.spy, hour: HOURS.find(h => h !== sol.hour), witness: sol.witness[0] });
  if (wrongHour.win) bad(777, '틀린 시각이 승리로 판정됐다');
  // 공범을 목격자로 지목 — 거짓을 깨기 전/후
  if (sol.witnessAfterBreak.length) {
    const acc = sol.witnessAfterBreak[0];
    const before = judgeAccusation(k, { spy: sol.spy, hour: sol.hour, witness: acc }, new Set());
    const after  = judgeAccusation(k, { spy: sol.spy, hour: sol.hour, witness: acc }, new Set([acc]));
    if (before.win) bad(777, '거짓을 깨지 않은 공범이 목격자로 인정됐다');
    if (before.witnessReason !== 'lie-not-broken') bad(777, `공범 미해결 사유가 틀렸다: ${before.witnessReason}`);
    if (!after.win) bad(777, '거짓을 깬 공범이 목격자로 인정되지 않았다');
  }
  // 첩자를 자기 목격자로 지목
  const selfW = judgeAccusation(k, { spy: sol.spy, hour: sol.hour, witness: sol.spy });
  if (selfW.win) bad(777, '첩자 자신이 목격자로 인정됐다');
}

// 6 재현성
const a = newSolvableCase(CAST, { seed: 12345 });
const b = newSolvableCase(CAST, { seed: 12345 });
if (JSON.stringify(a) !== JSON.stringify(b)) bad(12345, '같은 시드가 다른 사건을 만들었다');

// 통계
const stats = { spy: {}, hour: {}, witnesses: {}, accompliceIsWitness: 0 };
for (let i = 1; i <= 1000; i += 1) {
  const k = newSolvableCase(CAST, { seed: i });
  stats.spy[k.spy] = (stats.spy[k.spy] || 0) + 1;
  stats.hour[k.theftHour] = (stats.hour[k.theftHour] || 0) + 1;
  const w = k.solution.witness.length;
  stats.witnesses[w] = (stats.witnesses[w] || 0) + 1;
  if (k.solution.witnessAfterBreak.length) stats.accompliceIsWitness += 1;
}

console.log(`\n=== 사건 생성기 검증 (${N}판) ===\n`);
console.log('첩자 분포     ', JSON.stringify(stats.spy));
console.log('절도 시각 분포', JSON.stringify(stats.hour));
console.log('목격자 수 분포', JSON.stringify(stats.witnesses));
console.log(`공범이 서고에 있어 '깨야 증언되는 목격자'인 경우: ${stats.accompliceIsWitness}/1000`);
console.log('');
console.log(fail === 0 ? `\x1b[32m불변식 7종 전부 통과 (${N}판, 실패 0)\x1b[0m` : `\x1b[31m실패 ${fail}건\x1b[0m`);
console.log('');
process.exit(fail ? 1 : 0);
