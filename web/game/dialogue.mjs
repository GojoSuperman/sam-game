/**
 * 대사 생성 — SAM 을 쓰되, 세계의 진실은 코드가 쥔다.
 *
 * 계약:
 *   1. 결정론 엔진이 이 턴에 말해도 되는 사실(statement)을 먼저 확정한다.
 *   2. 그 사실만 담아 SAM 에 "말투로 바꿔라"고 시킨다.
 *   3. 돌아온 문장을 verifyReply 로 검사한다. 실패하면 최대 2회 재생성.
 *   4. 그래도 실패하거나 SAM 이 죽어 있으면 결정론 대사로 내려간다.
 *
 * 이 구조 덕분에 SAM 이 없어도 게임이 완전히 돌아간다. SAM 은 표현만 담당한다.
 *
 * 프록시 경유: 게임 페이지는 sam-proxy 가 서빙하므로 same-origin 이다.
 * 키는 서버에만 있고 브라우저에 내려오지 않는다.
 */

import { allowedFacts, verifyReply, deterministicLine, unknownLine } from './facts.mjs';
import { RKO, HOURS, ROOMS } from './case.mjs';

export const PROXY_URL = '/api/sam/v1/generate';

/** 티어 이름은 프록시가 실제 alias 로 바꿔준다. src/tiers.mjs 참고. */
export const MODELS = Object.freeze({
  line: 'light',    // 대사 한 줄 — 지연이 체감을 지배한다
  judge: 'light',   // 말투 표본 검사
});

export const state = {
  enabled: true,      // false 면 결정론만 쓴다
  lastError: '',
  calls: 0,
  fallbacks: 0,
  scredits: 0,
  timeoutMs: 9000,    // 대사 한 줄에 9초 이상 기다리지 않는다
};

async function callSam(messages, { model = MODELS.line, maxTokens = 220, temperature = 0.85, schema = null } = {}) {
  const body = {
    model,
    messages,
    options: {
      stream: false,          // ★ SAM 기본값은 true 다. 반드시 꺼야 JSON 이 온다
      max_tokens: maxTokens,
      temperature,
      ...(schema ? { json_schema: schema } : {}),
    },
  };
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(state.timeoutMs),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      detail = j?.error?.code || j?.detail || detail;
    } catch { /* HTML 오류 페이지 */ }
    throw new Error(detail);
  }
  const json = await res.json();
  state.calls += 1;
  if (typeof json?.usage?.scredits === 'number') state.scredits += json.usage.scredits;
  const c = json?.output?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : x?.text || '')).join('');
  return '';
}

/**
 * 인물 카드 — SPUM 캐릭터 JSON 의 persona 가 그대로 여기로 들어온다.
 * 이게 SPUM 에서 캐릭터를 만드는 것이 게임 내용에 직접 기여하는 지점이다.
 */
function personaBlock(ch) {
  const p = ch.persona || {};
  return [
    `이름: ${ch.name}`,
    p.occupation && `직업: ${p.occupation}`,
    p.mbti && `성향: ${p.mbti}`,
    p.traits?.length && `특징: ${p.traits.join(', ')}`,
    p.speechStyle && `말투: ${p.speechStyle}`,
    p.background && `배경: ${p.background}`,
  ].filter(Boolean).join('\n');
}

/**
 * 이 턴에 허용된 사실만 담은 지시문을 만든다.
 * 모델에게 "무엇을 말할지"는 주고 "무엇을 지어낼 자유"는 주지 않는다.
 */
function buildMessages(ch, statement, { names, signature, question, stance }) {
  const roomKo = RKO[statement.room] || statement.room;
  const sawKo = (statement.saw || []).map((s) => names[s] || s);

  const system = [
    '너는 중세 성의 심문 장면에서 한 인물의 대사만 쓴다.',
    '',
    '[인물]',
    personaBlock(ch),
    '',
    '[절대 규칙]',
    '- 아래 [말해도 되는 사실] 에 있는 시각·장소·사람만 언급한다.',
    '- 목록에 없는 시각·장소·사람을 한 글자도 넣지 않는다. 지어내면 그 대사는 폐기된다.',
    `- 이 세계의 장소는 ${ROOMS.map((r) => r.ko).join(' · ')} 뿐이다. 다른 장소는 존재하지 않는다.`,
    `- 이 세계의 시각은 ${HOURS.join(' · ')} 뿐이다.`,
    `- ${signature.maxSentences}문장 이내, 한 문장 ${signature.maxChars}자 이내.`,
    signature.endings.length ? `- 문장은 ${signature.endings.join(' 또는 ')} 로 끝낸다.` : '',
    signature.banned.length ? `- 다음 표현을 쓰지 않는다: ${signature.banned.join(', ')}` : '',
    '- 설명이나 따옴표 없이 대사 본문만 출력한다.',
    '',
    '[말해도 되는 사실]',
    `- 나는 ${statement.hour}에 ${roomKo}에 있었다.`,
    sawKo.length ? `- 그때 ${sawKo.join('과 ')}을 보았다.` : '- 그때 아무도 보지 못했다.',
    '',
    stance ? `[태도] ${stance}` : '',
  ].filter(Boolean).join('\n');

  const user = question
    ? `심문관의 말: "${question}"\n위 사실만으로 대답하라.`
    : '위 사실을 말하라.';

  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/**
 * 한 턴의 대사를 만든다. 항상 문장을 돌려준다 (실패해도 결정론 대사).
 * @returns {{ line: string, source: 'sam'|'fallback', tries: number, reasons: string[] }}
 */
export async function speak({ kase, character, statement, statements, names, signature, question, stance }) {
  const allowed = allowedFacts(kase, character.id, [...(statements || []), statement]);
  const reasons = [];

  if (state.enabled) {
    const messages = buildMessages(character, statement, { names, signature, question, stance });
    for (let tries = 1; tries <= 2; tries += 1) {
      try {
        const raw = await callSam(messages, { temperature: tries === 1 ? 0.85 : 0.5 });
        const line = String(raw || '').replace(/^["'\s]+|["'\s]+$/g, '').split('\n')[0].trim();
        const v = verifyReply(line, { allowed, names, signature });
        if (v.ok) return { line, source: 'sam', tries, reasons };
        reasons.push(`시도${tries}: ${v.reasons.join(' / ')}`);
      } catch (err) {
        state.lastError = String(err?.message || err);
        reasons.push(`시도${tries}: ${state.lastError}`);
        break; // 통신 실패는 재시도해도 같다 — 바로 내려간다
      }
    }
  }

  state.fallbacks += 1;
  return {
    line: deterministicLine(statement, { name: character.name, names }),
    source: 'fallback',
    tries: 0,
    reasons,
  };
}

/** 안 가 본 방을 물었을 때 — 결정론으로 충분하다. LLM 을 쓸 이유가 없다. */
export function speakUnknown(roomId) {
  return { line: unknownLine(roomId), source: 'fallback', tries: 0, reasons: [] };
}

/** 프록시가 살아 있는지 */
export async function health() {
  try {
    const r = await fetch('/healthz', { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
    return { ok: true, ...(await r.json()) };
  } catch (err) {
    return { ok: false, detail: String(err?.message || err) };
  }
}
