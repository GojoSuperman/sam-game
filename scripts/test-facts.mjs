#!/usr/bin/env node
/** verifyReply 검증 — 통과해야 할 것과 막아야 할 것을 둘 다 시험한다. */
import { newSolvableCase, statementOf, RKO } from '../web/game/case.mjs';
import { allowedFacts, verifyReply, deterministicLine } from '../web/game/facts.mjs';

const CAST = ['kyle', 'mira', 'dorn', 'howell', 'ben'];
const names = { kyle: '카일', mira: '미라', dorn: '도른', howell: '하웰', ben: '벤' };
const k = newSolvableCase(CAST, { seed: 42 });

const id = 'kyle';
const st = statementOf(k, id, '23시');
const allowed = allowedFacts(k, id, [st]);
const sig = { endings: ['소', '요', '다'], banned: ['ㅋ', '아마도'], maxSentences: 2, maxChars: 60 };

console.log('\n=== verifyReply 검증 ===\n');
console.log(`사건 seed 42 · 첩자=${names[k.spy]} · 절도=${k.theftHour} · 알리바이방=${RKO[k.fakeRoom]}`);
console.log(`카일의 23시 진술: ${RKO[st.room]} / 본 사람 ${st.saw.map(s=>names[s]).join(',')||'없음'} / 거짓=${st.lie}`);
console.log(`허용 시각 ${[...allowed.hours]} · 장소 ${[...allowed.rooms]} · 인물 ${[...allowed.people].map(p=>names[p])}\n`);

const cases = [
  ['통과', deterministicLine(st, { name: names[id], names }), true],
  ['통과', `${st.hour}엔 ${RKO[st.room]}에 있었소.`, true],
  ['막기', '04시엔 서고에 있었소.', false],                      // 허용 안 된 시각
  ['한계', `${st.hour}엔 지하실에 있었소.`, true],                // 세계에 없는 방은 목록에 없어 못 막는다 (문서화된 한계)
  ['막기', `${st.hour}엔 ${RKO[st.room]}에 있었소. 도른이 있었소.`, allowed.people.has('dorn')],
  ['막기', `${st.hour}엔 ${RKO[st.room]}에 있었소 ㅋ`, false],     // 금지 표현
  ['막기', `${st.hour}엔 ${RKO[st.room]}에 있었소. 그리고. 또. 더.`, false], // 문장 수
  ['막기', `${st.hour}엔 ${RKO[st.room]}에 있었는데 그것은 매우 길고 장황한 설명이어서 상한을 넘기고도 계속 이어지는 문장이오`, false],
  ['막기', `${st.hour}엔 ${RKO[st.room]}에 있었음`, false],        // 종결어미
  ['막기', '', false],
  // 한국어 조사가 붙은 형태 — 이전에 정규식이 통째로 실패했던 지점
  ['막기', '04시엔 서고에 있었소.', false],
  ['막기', '4시엔 서고에 있었소.', false],
  ['막기', '02시에 서고에 있었소.', false],
  ['통과', `${st.hour}에 ${RKO[st.room]}에 있었소.`, true],
  ['통과', `${st.hour}쯤 ${RKO[st.room]}에 있었소.`, true],
];

let fail = 0;
for (const [label, line, expectOk] of cases) {
  const r = verifyReply(line, { allowed, names, signature: sig });
  const pass = r.ok === expectOk;
  if (!pass) fail += 1;
  const tag = pass ? '\x1b[32mOK  \x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`${tag} [${label}] ok=${r.ok} 기대=${expectOk}  "${line.slice(0, 46)}${line.length > 46 ? '…' : ''}"`);
  if (r.reasons.length) console.log(`       사유: ${r.reasons.join(' / ')}`);
}

// 허용 밖 장소가 실제로 막히는지 — 진술 방이 아닌 다른 방 이름으로
const otherRoom = Object.values(RKO).find((ko) => ko !== RKO[st.room]);
const r2 = verifyReply(`${st.hour}엔 ${otherRoom}에 있었소.`, { allowed, names, signature: sig });
const pass2 = r2.ok === false;
if (!pass2) fail += 1;
console.log(`${pass2 ? '\x1b[32mOK  \x1b[0m' : '\x1b[31mFAIL\x1b[0m'} [막기] 허용 밖 장소 "${otherRoom}" → ok=${r2.ok} (${r2.reasons.join('/')})`);

console.log(`\n${fail === 0 ? '\x1b[32m전부 통과\x1b[0m' : `\x1b[31m실패 ${fail}건\x1b[0m`}\n`);
process.exit(fail ? 1 : 0);
