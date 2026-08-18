/**
 * 사실 검증 — LLM 이 세계를 바꾸지 못하게 막는 문(gate).
 *
 * seogo 원안의 verifyReply() 와 같은 역할이되, 검사 축을 하나 늘렸다.
 * 원안은 시각·장소·사람만 봤고, 그래서 "사실은 막지만 말투는 못 막는다"가
 * MISSING 으로 남았다. 여기서는 말투 서명까지 같은 문에서 본다.
 *
 * 순서가 중요하다. 비용이 0인 검사를 먼저 돌리고, 그걸 통과한 것만 남긴다.
 *   1) 허용 사실 밖의 시각/장소/사람 → 문장 폐기
 *   2) 그 인물의 말투 서명 위반    → 문장 폐기
 *   3) 길이/문장수 초과            → 문장 폐기
 * 폐기되면 호출부가 재생성하거나 결정론 대사로 내려간다.
 */

import { HOURS, RKO, ROOMS } from './case.mjs';

/**
 * 시각 추출.
 * 주의: 뒤에 \b 를 쓰면 안 된다. "23시엔" 처럼 한국어 조사가 붙으면
 * '시'와 '엔' 이 모두 단어 문자라 경계가 성립하지 않아 매칭이 통째로 실패한다.
 * (이 버그로 시각 검사가 전부 무력화된 적이 있다.)
 * 앞쪽은 lookbehind 로 숫자 연속만 막는다.
 */
const HOUR_RE = /(?<!\d)([0-2]?\d)\s*시/g;
const ROOM_KO = ROOMS.map((r) => r.ko);

/**
 * 인물이 이 턴에 말해도 되는 사실의 집합.
 * @param statements 이 인물이 이미 확정한 진술들 [{hour, room, saw[]}]
 */
export function allowedFacts(kase, id, statements = []) {
  const hours = new Set();
  const rooms = new Set();
  const people = new Set([kase.cast.find((c) => c === id)].filter(Boolean));
  for (const st of statements) {
    if (st.hour) hours.add(st.hour);
    if (st.room) rooms.add(RKO[st.room] || st.room);
    for (const p of st.saw || []) people.add(p);
  }
  return { hours, rooms, people };
}

/**
 * 이름 → 화면에 쓰는 한국어 이름. 인물 카드에서 온다.
 */
export function nameMap(characters) {
  const m = {};
  for (const c of characters) m[c.id] = c.name;
  return m;
}

/**
 * 말투 서명. persona.speechStyle 은 자연어라 검사에 쓸 수 없으므로,
 * 인물마다 검사 가능한 형태로 따로 준다. (SPUM persona 를 사람이 읽고 채운다)
 */
export const DEFAULT_SIGNATURE = Object.freeze({
  /** 반드시 이 중 하나로 끝나야 한다 (문장 종결) */
  endings: [],
  /** 나오면 안 되는 표현 */
  banned: [],
  /** 한 턴에 허용하는 문장 수 */
  maxSentences: 2,
  /** 한 문장 최대 길이 */
  maxChars: 60,
});

/**
 * LLM 이 만든 대사를 검사한다.
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function verifyReply(line, { allowed, names, signature = DEFAULT_SIGNATURE } = {}) {
  const reasons = [];
  const text = String(line || '').trim();
  if (!text) return { ok: false, reasons: ['빈 문장'] };

  // 1) 허용 밖의 시각
  for (const m of text.matchAll(HOUR_RE)) {
    const h = `${String(m[1]).padStart(2, '0')}시`;
    const alt = `${m[1]}시`;
    if (!allowed.hours.has(h) && !allowed.hours.has(alt)) {
      reasons.push(`허용 안 된 시각: ${m[0]}`);
    }
  }
  // 2) 허용 밖의 장소
  //    한계: 세계에 없는 방 이름(예: "지하실")은 목록에 없어 여기서 안 걸린다.
  //    다만 증언판은 파싱된 진술로만 만들어지므로 없는 방이 판에 오르지는 않는다.
  //    프롬프트에서 방 목록을 못 박는 것이 1차 방어다.
  for (const ko of ROOM_KO) {
    if (text.includes(ko) && !allowed.rooms.has(ko)) reasons.push(`허용 안 된 장소: ${ko}`);
  }
  // 3) 허용 밖의 사람
  for (const [id, nm] of Object.entries(names)) {
    if (!nm) continue;
    if (text.includes(nm) && !allowed.people.has(id)) reasons.push(`허용 안 된 인물: ${nm}`);
  }

  // 4) 말투 서명
  const sentences = text.split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length > signature.maxSentences) {
    reasons.push(`문장 ${sentences.length}개 (상한 ${signature.maxSentences})`);
  }
  for (const s of sentences) {
    if (s.length > signature.maxChars) reasons.push(`문장이 ${s.length}자 (상한 ${signature.maxChars})`);
  }
  for (const b of signature.banned) {
    if (b && text.includes(b)) reasons.push(`금지 표현: ${b}`);
  }
  if (signature.endings.length) {
    const last = sentences[sentences.length - 1].replace(/[.!?…\s]+$/, '');
    if (!signature.endings.some((e) => last.endsWith(e))) {
      reasons.push(`종결어미 불일치 (허용: ${signature.endings.join('/')})`);
    }
  }

  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

/** 검증에 실패했을 때 쓰는 결정론 대사. LLM 없이도 게임이 성립하게 만든다. */
export function deterministicLine(statement, { name, names }) {
  const { hour, room, saw = [], lie } = statement;
  const roomKo = RKO[room] || room;
  if (!saw.length) {
    return lie
      ? `${hour}엔 ${roomKo}에 있었소. 아무도 없었소.`
      : `${hour}엔 ${roomKo}에 있었소. 본 사람은 없소.`;
  }
  const who = saw.map((s) => names[s] || s).join('과 ');
  return `${hour}엔 ${roomKo}에 있었소. ${who}이 있었소.`;
}

/** 안 가 본 방을 물었을 때 — "비어 있었다"가 아니라 "모른다". 추리의 뼈대다. */
export function unknownLine(roomId) {
  return `${RKO[roomId] || roomId}는 가 보지 않았소. 모르오.`;
}
