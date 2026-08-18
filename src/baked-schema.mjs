/**
 * SPUM 월드 bakedData (schemaVersion "0.4") 검증·정규화.
 *
 * 규칙은 SPUM 자체 구현에서 그대로 가져왔다:
 *   studio/pages/world/WorldBakeBuilder.js  → normalizeGeneratedBakedData()
 *   studio/pages/world/WorldBakeConfig.js   → WORLD_BAKE_BUILDER_SAM_LIMITS
 *
 * 여기서 미리 걸러내야 하는 이유: Studio 가 import 할 때 조용히 버리는 항목이 많다.
 * (participants 가 2명이 아니거나, speaker 가 배치 캐릭터가 아니거나, turns 가 2개
 *  미만이면 그 thread 는 그냥 사라진다.) 우리가 먼저 검증하면 왜 줄었는지 알 수 있다.
 */

/** WorldSpeechDirector / speech.emote 가 실제로 재생하는 라벨 */
export const EMOTIONS = Object.freeze(['neutral', 'happy', 'greet', 'surprised', 'thinking', 'proud', 'calm']);
export const INTENTS = Object.freeze(['open', 'reply', 'finish']);
export const BEHAVIORS = Object.freeze(['idle', 'walk', 'approach']);

/** detailLevel 별 상한. Studio 가 SAM 호출 전에 이 값으로 clamp 한다. */
export const SAM_LIMITS = Object.freeze({
  summary: { threadCount: 6, turnsPerThread: 3, thoughtCount: 1, maxLineChars: 42 },
  balanced: { threadCount: 8, turnsPerThread: 4, thoughtCount: 2, maxLineChars: 54 },
  rich: { threadCount: 10, turnsPerThread: 4, thoughtCount: 2, maxLineChars: 56 },
});

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

export function clipLine(value, max = 54) {
  const text = clean(value);
  const limit = Math.max(24, Number(max) || 54);
  return text.length <= limit ? text : `${text.slice(0, limit - 3).trim()}...`;
}

/**
 * 모델이 만든 bakedData 후보를 SPUM 이 받아들이는 모양으로 정규화한다.
 * @returns {{ bakedData: object, report: { keptThreads:number, droppedThreads:Array, keptTurns:number, droppedTurns:number, thoughtLines:number } }}
 */
export function normalizeBakedData(candidate, { characters, limits, concept = '', tone = '', detailLevel = 'balanced', generationMode = 'company' }) {
  const names = new Set(characters.map((c) => c.name));
  const raw = candidate?.bakedData && typeof candidate.bakedData === 'object' ? candidate.bakedData : (candidate || {});
  const maxLine = limits.maxLineChars;

  const droppedThreads = [];
  let droppedTurns = 0;
  let keptTurns = 0;

  const threads = (Array.isArray(raw.threads) ? raw.threads : []).map((thread, i) => {
    const turns = (Array.isArray(thread?.turns) ? thread.turns : []).map((turn) => {
      const speaker = clean(turn?.speaker || turn?.role || turn?.character);
      const line = clipLine(turn?.line || turn?.text || turn?.content, maxLine);
      if (!speaker || !names.has(speaker) || !line) { droppedTurns += 1; return null; }
      const emotion = clean(turn?.emotion) || 'neutral';
      const intent = clean(turn?.intent) || 'reply';
      return {
        speaker,
        line,
        emotion: EMOTIONS.includes(emotion) ? emotion : 'neutral',
        intent: INTENTS.includes(intent) ? intent : 'reply',
      };
    }).filter(Boolean).slice(0, limits.turnsPerThread);

    // 마지막 turn 은 finish, 첫 turn 은 open 이어야 재생이 자연스럽다.
    if (turns.length) {
      turns[0].intent = 'open';
      turns[turns.length - 1].intent = 'finish';
      for (let t = 1; t < turns.length - 1; t += 1) turns[t].intent = 'reply';
    }

    const declared = Array.isArray(thread?.participants) ? thread.participants : turns.map((t) => t.speaker);
    const participants = [];
    const unknownNames = [];
    for (const n of declared) {
      const c = clean(n);
      if (!c) continue;
      if (!names.has(c)) { if (!unknownNames.includes(c)) unknownNames.push(c); continue; }
      if (!participants.includes(c)) participants.push(c);
    }

    if (participants.length < 2 || turns.length < 2) {
      // 실무에서 가장 흔한 실패는 모델이 배치되지 않은 이름을 쓰는 것이다.
      // 그 경우를 participants 부족과 구분해서 보고해야 원인이 바로 보인다.
      const reason = unknownNames.length
        ? `배치 캐릭터가 아닌 이름 사용: ${unknownNames.join(', ')} (유효 participants ${participants.length}명)`
        : participants.length < 2
          ? `participants 가 ${participants.length}명 (배치 캐릭터 이름 2개 필요)`
          : `turns 가 ${turns.length}개 (2개 이상 필요)`;
      droppedThreads.push({
        index: i,
        topic: clean(thread?.topic) || `(topic 없음 #${i + 1})`,
        reason,
      });
      return null;
    }
    keptTurns += turns.length;
    return {
      id: clean(thread?.id) || `bake_thread_${String(i + 1).padStart(2, '0')}`,
      topic: clipLine(thread?.topic || turns[0].line, 36),
      participants: participants.slice(0, 2),
      turns,
    };
  }).filter(Boolean).slice(0, limits.threadCount);

  // thoughts: 캐릭터별 idle/walk/approach 큐
  const thoughts = {};
  for (const c of characters) {
    const src = raw?.thoughts?.[c.name] || {};
    thoughts[c.name] = {};
    for (const behavior of BEHAVIORS) {
      const cap = behavior === 'idle' ? limits.thoughtCount : Math.max(1, limits.thoughtCount);
      const entries = (Array.isArray(src[behavior]) ? src[behavior] : []).map((e) => {
        const text = clipLine(e?.text || e, Math.min(48, maxLine));
        if (!text) return null;
        const emotion = clean(e?.emotion) || (behavior === 'approach' ? 'greet' : 'thinking');
        return { text, emotion: EMOTIONS.includes(emotion) ? emotion : 'neutral' };
      }).filter(Boolean).slice(0, cap);
      thoughts[c.name][behavior] = entries.length ? entries : [{
        text: behavior === 'approach' ? '이야기를 이어갈게요.' : behavior === 'walk' ? '다음 자리로 이동 중이에요.' : '조용히 생각을 정리해요.',
        emotion: behavior === 'approach' ? 'greet' : 'neutral',
      }];
    }
  }

  const thoughtLines = Object.values(thoughts)
    .reduce((sum, m) => sum + Object.values(m).reduce((s, a) => s + a.length, 0), 0);

  const charactersMap = {};
  for (const c of characters) {
    charactersMap[c.name] = {
      id: c.id || c.name,
      name: c.name,
      displayName: c.displayName || c.name,
      title: c.title || 'SPUM 캐릭터',
      speechStyle: c.speechStyle || '',
    };
  }

  return {
    bakedData: {
      meta: {
        schemaVersion: '0.4',
        generatedAt: new Date().toISOString(),
        source: 'sam-game-bake-cli',
        concept: concept || raw?.meta?.concept || '',
        generationMode,
        detailLevel,
        tone,
      },
      characters: charactersMap,
      thoughts,
      threads,
    },
    report: {
      keptThreads: threads.length,
      droppedThreads,
      keptTurns,
      droppedTurns,
      thoughtLines,
      characters: characters.length,
    },
  };
}

/** Studio 가 실제로 로드 가능한 최소 조건인지 확인. */
export function assertLoadable(bakedData) {
  const problems = [];
  if (!Array.isArray(bakedData?.threads) || bakedData.threads.length === 0) {
    problems.push('threads 가 비어 있음 — Studio 가 "생성된 베이크 데이터가 유효하지 않습니다" 로 거부한다');
  }
  if (!bakedData?.characters || Object.keys(bakedData.characters).length < 2) {
    problems.push('characters 가 2명 미만 — 대화 상대가 없다');
  }
  return problems;
}
