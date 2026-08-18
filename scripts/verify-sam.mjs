#!/usr/bin/env node
/**
 * SAM 연결 검증. 추측 없이 실제로 호출해서 확인한다.
 *
 *   node --env-file=.env.local scripts/verify-sam.mjs
 *
 * 확인 항목:
 *   1) 키 유효성 + 쌤 잔액           GET  /v1/account
 *   2) 모델 카탈로그 + 티어 매핑 실재  GET  /v1/models
 *   3) 논스트리밍 텍스트 생성         POST /v1/generate
 *   4) 구조화 JSON (퀘스트 생성)      POST /v1/generate + options.json_schema
 *   5) SSE 스트리밍                  POST /v1/generate + options.stream
 *   6) NPC 행동 커맨드 JSON 왕복      SPUM RuntimeCommands 스키마 준수 여부
 */
import { getAccount, listModels, generate, generateStream, parseJsonLoose } from '../src/sam.mjs';
import { TIER_TO_ALIAS, resolveModel } from '../src/tiers.mjs';

const pass = (m) => console.log(`  \x1b[32mPASS\x1b[0m ${m}`);
const fail = (m) => { console.log(`  \x1b[31mFAIL\x1b[0m ${m}`); failures += 1; };
const info = (m) => console.log(`       ${m}`);
const onRetry = ({ attempt, retries, waitSec, error }) =>
  console.log(`       \x1b[33m재시도\x1b[0m ${attempt}/${retries} — ${error.status} ${error.code.slice(0, 40)} · ${waitSec}s 대기`);
let failures = 0;

console.log('\n=== SAM 연결 검증 ===\n');

// 1) 계정
console.log('[1] GET /v1/account — 키 유효성과 잔액');
let account = null;
try {
  account = await getAccount();
  pass('키 인증 성공');
  const keys = ['ssam_total', 'ssam_used', 'ssam_remaining', 'models_available', 'api_keys_count', 'plan_code', 'plan_display_name'];
  for (const k of keys) if (account?.[k] !== undefined) info(`${k} = ${JSON.stringify(account[k])}`);
} catch (err) {
  fail(String(err.message || err));
  if (err.status === 401) info('키가 잘못됐거나 만료됐습니다. sam.soonsoon.ai/api-keys 에서 확인하세요.');
  console.log('\n계정 인증이 안 되면 나머지 검사는 의미가 없습니다. 중단합니다.\n');
  process.exit(1);
}

// 2) 모델 카탈로그 — 티어 매핑이 실제로 존재하는 alias 인지
console.log('\n[2] GET /v1/models — 티어 매핑 실재 확인');
try {
  const { models, count } = await listModels();
  const aliases = new Set(models.map((m) => m.alias));
  pass(`모델 ${count}개 조회`);
  for (const [tier, alias] of Object.entries(TIER_TO_ALIAS)) {
    if (aliases.has(alias)) {
      const m = models.find((x) => x.alias === alias);
      pass(`${tier.padEnd(6)} -> ${alias.padEnd(20)} (${m.avg_latency_ms}ms, $${m.pricing.input_per_1m}/$${m.pricing.output_per_1m} per 1M)`);
    } else {
      fail(`${tier} -> ${alias} : SAM 에 없는 alias. src/tiers.mjs 를 고쳐야 합니다.`);
    }
  }
  for (const tier of ['light', 'medium', 'expert']) {
    if (aliases.has(tier)) fail(`'${tier}' 가 SAM 실제 alias 로 존재합니다 — 변환 전제가 깨졌으니 tiers.mjs 재검토 필요`);
  }
  if (!['light', 'medium', 'expert'].some((t) => aliases.has(t))) {
    pass("'light'/'medium'/'expert' 는 SAM alias 가 아님 — 프록시 변환이 반드시 필요하다는 전제 확인");
  }
} catch (err) {
  fail(String(err.message || err));
}

// 3) 텍스트 생성
console.log('\n[3] POST /v1/generate — 논스트리밍 텍스트 (NPC 한 마디)');
try {
  const r = await generate({
    onRetry,
    model: resolveModel('light'),
    messages: [
      { role: 'system', content: '너는 SPUM 픽셀 월드의 떠돌이 상인 "루"다. 능글맞은 반말. 말풍선용으로 40자 이내 한 문장.' },
      { role: 'user', content: '플레이어가 처음 말을 걸었다.' },
    ],
    options: { temperature: 0.9, max_tokens: 200 },
  });
  if (r.text.trim()) {
    pass(`응답 수신 (${r.text.length}자, ${r.meta.duration_ms}ms)`);
    info(`루: "${r.text.trim()}"`);
    info(`비용 ${r.usage.scredits} 쌤 / $${r.usage.cost_usd} · provider=${r.meta.provider}`);
  } else {
    fail('응답 텍스트가 비었습니다');
  }
} catch (err) {
  fail(String(err.message || err));
}

// 4) 구조화 JSON — 동적 퀘스트
console.log('\n[4] POST /v1/generate + json_schema — 동적 퀘스트 생성');
const QUEST_SCHEMA = {
  type: 'object',
  required: ['title', 'description', 'objectives', 'reward'],
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    objectives: { type: 'array', items: { type: 'object', required: ['id', 'text'], properties: { id: { type: 'string' }, text: { type: 'string' }, count: { type: 'integer' } } } },
    reward: { type: 'object', properties: { gold: { type: 'integer' }, item: { type: 'string' } } },
  },
};
try {
  const r = await generate({
    onRetry,
    model: resolveModel('expert'),
    messages: [
      { role: 'system', content: '너는 게임의 퀘스트 설계자다. 스키마에 맞는 JSON 객체만 출력한다.' },
      { role: 'user', content: '월드 목표: 사라진 마을 우물의 물을 되찾는다. 등장인물: 하늘(마을 이장), 루(떠돌이 상인). 다음 퀘스트 하나를 설계해줘.' },
    ],
    options: { json_schema: QUEST_SCHEMA, max_tokens: 1200, temperature: 0.7 },
  });
  const quest = parseJsonLoose(r.text);
  if (quest?.title && Array.isArray(quest.objectives) && quest.objectives.length) {
    pass(`구조화 출력 파싱 성공 (목표 ${quest.objectives.length}개)`);
    info(`퀘스트: ${quest.title} — ${quest.description}`);
    for (const o of quest.objectives) info(`  · [${o.id}] ${o.text}${o.count ? ` x${o.count}` : ''}`);
    info(`보상: ${JSON.stringify(quest.reward)}`);
  } else {
    fail(`JSON 이 스키마를 만족하지 않습니다: ${r.text.slice(0, 200)}`);
  }
} catch (err) {
  fail(String(err.message || err));
}

// 5) SSE 스트리밍
console.log('\n[5] POST /v1/generate (stream) — SSE 이벤트 파싱');
try {
  const seen = new Map();
  let streamed = '';
  let firstChunkAt = null;
  const t0 = Date.now();
  for await (const ev of generateStream({
    onRetry,
    model: resolveModel('light'),
    messages: [{ role: 'user', content: '마을 우물이 마른 이유를 NPC 대사 두 줄로 말해줘.' }],
    options: { max_tokens: 300 },
  })) {
    const type = ev.type || (ev.text != null ? 'content' : 'unknown');
    seen.set(type, (seen.get(type) || 0) + 1);
    if (ev.text) { streamed += ev.text; firstChunkAt ??= Date.now() - t0; }
  }
  if (streamed.trim()) {
    pass(`스트리밍 ${streamed.length}자 수신 · 첫 토큰 ${firstChunkAt}ms`);
    info(`이벤트 종류: ${[...seen.entries()].map(([k, v]) => `${k}x${v}`).join(', ')}`);
  } else {
    fail(`스트림에서 텍스트를 못 받았습니다. 이벤트: ${[...seen.keys()].join(', ') || '(없음)'}`);
  }
} catch (err) {
  fail(String(err.message || err));
}

// 6) NPC 행동 커맨드 — SPUM RuntimeCommands 스키마 준수
console.log('\n[6] NPC 행동 커맨드 — SPUM RuntimeCommands 호환성');
const VALID_COMMANDS = new Set([
  'say', 'think', 'remember', 'setRuntime', 'playState', 'playEmote', 'playEffect', 'stopEffect',
  'moveToTile', 'moveToPoint', 'moveToActor', 'moveToConversationSpot', 'wander', 'idle', 'rest', 'sleep',
]);
try {
  const r = await generate({
    onRetry,
    model: resolveModel('expert'),
    messages: [
      {
        role: 'system',
        content: [
          '너는 SPUM 월드 NPC 의 행동 결정기다. JSON 객체만 출력한다.',
          '형식: {"summary":"한 줄 요약","commands":[{"type":"...", ...}]}',
          `허용 type: ${[...VALID_COMMANDS].join(', ')}`,
          'say/think 은 text 와 emotion 을, moveToActor 는 targetInstanceId 를, playEmote 는 emote 를 갖는다.',
          'emote 는 happy|greet|surprised|thinking|proud 중 하나.',
        ].join('\n'),
      },
      { role: 'user', content: '상황: 상인 "루"(instanceId=cast_02)가 이장 "하늘"(instanceId=cast_01) 에게 다가가 우물 이야기를 꺼낸다. 하늘의 행동을 결정해라.' },
    ],
    options: { max_tokens: 900, temperature: 0.6 },
  });
  const parsed = parseJsonLoose(r.text);
  const commands = Array.isArray(parsed?.commands) ? parsed.commands : [];
  if (!commands.length) {
    fail(`commands 배열이 없습니다: ${r.text.slice(0, 200)}`);
  } else {
    const bad = commands.filter((c) => !VALID_COMMANDS.has(String(c?.type || c?.action || '')));
    if (bad.length) {
      fail(`SPUM 이 버릴 커맨드 ${bad.length}개: ${bad.map((c) => c.type || c.action).join(', ')}`);
    } else {
      pass(`커맨드 ${commands.length}개 전부 SPUM RuntimeCommands 호환`);
    }
    info(`summary: ${parsed.summary || '(없음)'}`);
    for (const c of commands) info(`  · ${c.type}${c.text ? `: "${c.text}"` : ''}${c.emote ? ` (${c.emote})` : ''}${c.targetInstanceId ? ` -> ${c.targetInstanceId}` : ''}`);
  }
} catch (err) {
  fail(String(err.message || err));
}

console.log(`\n=== ${failures === 0 ? '\x1b[32m전부 통과\x1b[0m' : `\x1b[31m실패 ${failures}건\x1b[0m`} ===\n`);
process.exit(failures === 0 ? 0 : 1);
