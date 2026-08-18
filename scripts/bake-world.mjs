#!/usr/bin/env node
/**
 * SPUM 월드용 bakedData 생성 CLI.
 *
 * 배포된 SPUM 월드(world-viewer)는 라이브 LLM 을 못 쓴다 — viewer.js 가
 * conversationMode 를 'baked' 로 강제하고 apiKey 를 '' 로 덮어쓴다.
 * 따라서 "배포되는 게임의 내용"은 전부 bakedData 안에 들어가야 한다.
 * 이 스크립트가 그 bakedData 를 SAM 으로 만든다.
 *
 * 사용:
 *   node --env-file=.env.local scripts/bake-world.mjs --config bake/my-world.json
 *   node --env-file=.env.local scripts/bake-world.mjs --config bake/my-world.json --model expert --detail rich
 *
 * 결과: out/<worldSlug>-bakedData.json
 *   → Studio 월드의 world.runtime.bakedData 에 넣고 publish 하면 재생된다.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { generate } from '../src/sam.mjs';
import { resolveModel } from '../src/tiers.mjs';
import { normalizeBakedData, assertLoadable, SAM_LIMITS } from '../src/baked-schema.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const configPath = arg('config');
if (!configPath) {
  console.error(`사용법: node --env-file=.env.local scripts/bake-world.mjs --config <설정.json>

설정 파일 형식:
{
  "worldSlug": "my-world",
  "worldTitle": "이름 없는 마을",
  "purpose": "방문자에게 마을의 사건을 알려주는 미스터리 도입부",
  "tone": "차분하고 약간 불안한 시골 미스터리",
  "generationMode": "story",
  "sourceText": "세계관·사건·설정을 여기 길게 붙여넣는다. 모델은 여기 있는 사실만 쓴다.",
  "characters": [
    { "name": "하늘", "title": "마을 이장", "speechStyle": "느릿하고 정중한 존댓말" },
    { "name": "루", "title": "떠돌이 상인", "speechStyle": "빠르고 능글맞은 반말" }
  ]
}`);
  process.exit(1);
}

const config = JSON.parse(await readFile(resolve(configPath), 'utf8'));
const detailLevel = arg('detail', config.detailLevel || 'balanced');
const limits = SAM_LIMITS[detailLevel] || SAM_LIMITS.balanced;
const modelTier = arg('model', config.model || 'expert');
const model = resolveModel(modelTier);

const characters = (config.characters || []).map((c) => ({
  id: c.id || c.name,
  name: String(c.name || '').trim(),
  displayName: c.displayName || c.name,
  title: c.title || 'SPUM 캐릭터',
  speechStyle: c.speechStyle || '',
})).filter((c) => c.name);

if (characters.length < 2) {
  console.error('[bake] 캐릭터가 2명 이상 필요합니다 (thread 는 항상 2인 대화입니다).');
  process.exit(1);
}
if (!String(config.sourceText || '').trim()) {
  console.error('[bake] sourceText 가 비어 있습니다. 모델은 여기 없는 사실을 지어내지 않도록 지시돼 있어, 비면 내용 없는 대화가 나옵니다.');
  process.exit(1);
}

// 프롬프트 계약은 SPUM 의 buildSamBakeGenerationMessages() 를 따른다.
// 같은 스키마·같은 금지사항을 쓰지 않으면 Studio import 단계에서 조용히 버려진다.
const systemPrompt = [
  '너는 SPUM World 의 베이크 대화 시나리오 작가다.',
  '입력 자료에 있는 사실만 사용하고, 없는 설정·날짜·수량·이름을 지어내지 않는다.',
  '각 thread 는 앞 thread 에서 뒤 thread 로 자연스럽게 이어져야 한다.',
  '각 turn 은 직전 대사의 의미를 받아서 한 단계만 전개한다. 독립 문장 나열처럼 쓰지 않는다.',
  '아래 "캐릭터" 목록에 있는 이름만 speaker 와 participants 에 사용한다.',
  'participants 는 정확히 2명이다. turns 는 최소 2개다.',
  `line 은 ${limits.maxLineChars}자를 넘기지 않고 한 문장으로 끝낸다. 방문자가 보는 말풍선이다.`,
  '이모지, 감탄사 남발, 과장된 홍보 문장, "뭐예요?" 반복 Q&A 를 피한다.',
  'emotion 은 neutral | happy | greet | surprised | thinking | proud | calm 중 하나.',
  'intent 는 open(첫 turn) | reply(중간) | finish(마지막 turn).',
  '반드시 JSON 객체만 응답한다. 코드펜스도 설명도 붙이지 않는다.',
  '배열 요소와 객체 속성 사이에는 쉼표를 넣고, 마지막 요소 뒤 trailing comma 는 넣지 않는다.',
  '스키마: {"meta":{"concept":""},"thoughts":{"캐릭터명":{"idle":[{"text":"","emotion":"thinking"}],"walk":[{"text":"","emotion":"neutral"}],"approach":[{"text":"","emotion":"greet"}]}},"threads":[{"id":"","topic":"","participants":["캐릭터명","캐릭터명"],"turns":[{"speaker":"캐릭터명","line":"","emotion":"greet","intent":"open"}]}]}',
].join('\n');

const userPrompt = [
  `월드: ${config.worldTitle || config.worldSlug || 'SPUM World'}`,
  `목적: ${config.purpose || '-'}`,
  `타입: ${config.generationMode || 'story'}`,
  `상세: ${detailLevel}`,
  `톤: ${config.tone || '-'}`,
  `출력 한도: threads 정확히 ${limits.threadCount}개, thread 당 turns ${limits.turnsPerThread}개, 캐릭터별 idle thoughts ${limits.thoughtCount}개`,
  '',
  '캐릭터:',
  ...characters.map((c) => `- ${c.name}: ${c.title}${c.speechStyle ? `, 말투=${c.speechStyle}` : ''}`),
  '',
  '입력 자료:',
  String(config.sourceText),
].join('\n');

console.log(`[bake] 모델 ${modelTier} -> ${model} / detail=${detailLevel} / threads=${limits.threadCount}x${limits.turnsPerThread}turns`);
const started = Date.now();

const result = await generate({
  model,
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ],
  options: {
    stream: false,
    temperature: 0.8,
    max_tokens: 8000,
    // json_schema 를 주면 SAM 이 구조화 출력을 강제한다. native 미지원 모델은
    // SAM 이 JSON-only prompt fallback 으로 보정한다 (문서 Structured Output Fallback).
    json_schema: {
      type: 'object',
      required: ['threads'],
      properties: {
        meta: { type: 'object', properties: { concept: { type: 'string' } } },
        thoughts: { type: 'object' },
        threads: {
          type: 'array',
          items: {
            type: 'object',
            required: ['participants', 'turns'],
            properties: {
              id: { type: 'string' },
              topic: { type: 'string' },
              participants: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 },
              turns: {
                type: 'array',
                minItems: 2,
                items: {
                  type: 'object',
                  required: ['speaker', 'line'],
                  properties: {
                    speaker: { type: 'string' },
                    line: { type: 'string' },
                    emotion: { type: 'string' },
                    intent: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
});

const { parseJsonLoose } = await import('../src/sam.mjs');
const candidate = parseJsonLoose(result.text);
if (!candidate) {
  console.error('[bake] SAM 응답을 JSON 으로 파싱하지 못했습니다. 원문 앞부분:');
  console.error(result.text.slice(0, 800));
  process.exit(1);
}

const { bakedData, report } = normalizeBakedData(candidate, {
  characters,
  limits,
  detailLevel,
  concept: config.purpose || '',
  tone: config.tone || '',
  generationMode: config.generationMode || 'story',
});

const problems = assertLoadable(bakedData);

const outPath = resolve(`out/${config.worldSlug || 'world'}-bakedData.json`);
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(bakedData, null, 2)}\n`, 'utf8');

console.log('');
console.log(`[bake] ${Date.now() - started}ms · request_id=${result.requestId}`);
console.log(`[bake] 비용: ${result.usage.total_tokens ?? '?'} tokens / $${result.usage.cost_usd ?? '?'} / ${result.usage.scredits ?? '?'} 쌤 (잔액 ${result.usage.scredits_remaining ?? '?'})`);
console.log(`[bake] provider=${result.meta.provider ?? '?'} model_id=${result.meta.model_id ?? '?'}`);
console.log('');
console.log(`[bake] thread ${report.keptThreads}개 채택 / turn ${report.keptTurns}개 / thought ${report.thoughtLines}줄`);
if (report.droppedTurns) console.log(`[bake] turn ${report.droppedTurns}개 폐기 (speaker 가 배치 캐릭터가 아니거나 line 이 빈 경우)`);
for (const d of report.droppedThreads) console.log(`[bake] thread 폐기: "${d.topic}" — ${d.reason}`);
for (const p of problems) console.log(`[bake] 경고: ${p}`);
console.log('');
console.log(`[bake] 저장: ${outPath}`);
console.log('[bake] 이 JSON 을 Studio 월드의 world.runtime.bakedData 에 넣고, world.ai.conversationMode 를 "baked" 로 두면 배포 링크에서 재생됩니다.');

// 첫 thread 를 미리보기로 출력 — 톤이 원하는 방향인지 즉시 판단할 수 있게.
const first = bakedData.threads[0];
if (first) {
  console.log('');
  console.log(`--- 미리보기: ${first.topic} (${first.participants.join(' <-> ')}) ---`);
  for (const t of first.turns) console.log(`  ${t.speaker} [${t.emotion}/${t.intent}]: ${t.line}`);
}
