/**
 * SPUM Studio Export 산출물 로더/검증기.
 *
 * SPUM Studio → Cast → Export 탭에서 나오는 것:
 *   A. 스프라이트 시트   <이름>_sheet.png  +  <이름>_sheet.json   ("PNG + JSON" 버튼)
 *   C. 캐릭터 JSON       <이름>_<버전>.json                        ("JSON 내보내기" 버튼)
 *
 * sheet.json 스키마 (CastPage.js `_exportSheetMeta` 실측):
 *   characterId characterName state clipId duration fps
 *   totalFrames frameWidth frameHeight columns rows sheetWidth sheetHeight
 *   background zoom offsetX offsetY exportDate
 *
 * 프레임 배열은 균일 그리드다 — columns × rows, 좌→우 · 상→하로 totalFrames 개.
 * 상태(state)마다 시트가 따로 나오므로 한 캐릭터에 여러 쌍이 생긴다.
 *
 * 이 모듈은 Node 와 브라우저 양쪽에서 쓴다 — DOM/fs 에 의존하지 않는다.
 */

/** 게임에서 쓰는 상태. SPUM animation 필드와 emote 라벨에서 온다. */
export const STATES = Object.freeze(['idle', 'walk', 'rest', 'sleep']);
export const EMOTES = Object.freeze(['happy', 'greet', 'surprised', 'thinking', 'proud']);

const NUM = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);

/**
 * sheet.json 을 검증하고 프레임 사각형 목록까지 계산해 돌려준다.
 * @returns {{ ok: boolean, problems: string[], sheet: object|null }}
 */
export function parseSheetMeta(raw, { label = 'sheet.json' } = {}) {
  const problems = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, problems: [`${label}: 객체가 아닙니다`], sheet: null };
  }

  const fw = NUM(raw.frameWidth);
  const fh = NUM(raw.frameHeight);
  const cols = NUM(raw.columns);
  const rows = NUM(raw.rows);
  const total = NUM(raw.totalFrames);
  const fps = NUM(raw.fps);
  const sw = NUM(raw.sheetWidth);
  const sh = NUM(raw.sheetHeight);

  for (const [k, v] of Object.entries({ frameWidth: fw, frameHeight: fh, columns: cols, rows, totalFrames: total })) {
    if (!Number.isFinite(v) || v <= 0) problems.push(`${label}: ${k} 가 양수가 아닙니다 (${raw[k]})`);
  }
  if (problems.length) return { ok: false, problems, sheet: null };

  // 그리드 정합성 — 여기서 어긋나면 렌더가 조용히 밀린다
  if (total > cols * rows) {
    problems.push(`${label}: totalFrames ${total} > columns×rows ${cols * rows} — 프레임이 시트에 안 들어갑니다`);
  }
  if (Number.isFinite(sw) && sw !== cols * fw) {
    problems.push(`${label}: sheetWidth ${sw} ≠ columns×frameWidth ${cols * fw}`);
  }
  if (Number.isFinite(sh) && sh !== rows * fh) {
    problems.push(`${label}: sheetHeight ${sh} ≠ rows×frameHeight ${rows * fh}`);
  }

  const frames = [];
  for (let i = 0; i < total; i += 1) {
    frames.push({
      i,
      sx: (i % cols) * fw,
      sy: Math.floor(i / cols) * fh,
      w: fw,
      h: fh,
    });
  }

  return {
    ok: problems.length === 0,
    problems,
    sheet: {
      characterId: String(raw.characterId || ''),
      characterName: String(raw.characterName || ''),
      // SPUM 은 state 를 대문자로 내보낸다 (IDLE 등). 게임 내부는 소문자로 통일한다.
      state: String(raw.state || '').toLowerCase(),
      clipId: String(raw.clipId || ''),
      fps: Number.isFinite(fps) && fps > 0 ? fps : 12,
      frameWidth: fw,
      frameHeight: fh,
      columns: cols,
      rows,
      totalFrames: total,
      sheetWidth: Number.isFinite(sw) ? sw : cols * fw,
      sheetHeight: Number.isFinite(sh) ? sh : rows * fh,
      background: String(raw.background ?? ''),
      frames,
    },
  };
}

/**
 * 캐릭터 JSON(Export 탭 C)에서 게임이 쓸 것만 뽑는다.
 * persona 는 심문 프롬프트의 인물 카드로 그대로 들어간다.
 */
export function parseCharacterJson(raw, { label = 'character.json' } = {}) {
  const problems = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, problems: [`${label}: 객체가 아닙니다`], character: null };
  }
  const name = String(raw.name || '').trim();
  if (!name) problems.push(`${label}: name 이 비었습니다`);

  const p = raw.persona || {};
  const v = raw.profiles?.village || {};
  const character = {
    id: String(raw.id || name),
    name,
    schemaVersion: raw.schemaVersion ?? null,
    version: String(raw.version || ''),
    license: String(raw.license || ''),
    persona: {
      occupation: String(p.occupation || '').trim(),
      mbti: String(p.mbti || '').trim(),
      age: p.age ?? null,
      gender: String(p.gender || '').trim(),
      personality: Array.isArray(p.personality) ? p.personality.map(String) : [],
      traits: Array.isArray(p.traits) ? p.traits.map(String) : [],
      speechStyle: String(p.speechStyle || '').trim(),
      background: String(p.background || '').trim(),
    },
    village: {
      role: String(v.role || '').trim(),
      mood: String(v.mood || '').trim(),
      schedule: Array.isArray(v.schedule) ? v.schedule.slice(0, 24) : [],
    },
    // 어떤 상태/이모트에 클립이 붙어 있는지 — export 해야 할 시트 목록이 여기서 나온다
    animation: {
      states: Object.fromEntries(STATES.map((s) => [s, String(raw.animation?.[s] || '').trim()])),
      emotes: Object.fromEntries(EMOTES.map((e) => [e, String(raw.animation?.emotes?.[e] || '').trim()])),
    },
  };

  // 심문 게임은 말투가 곧 인물이다. 비어 있으면 프롬프트가 맹탕이 된다.
  if (!character.persona.speechStyle) problems.push(`${label}: persona.speechStyle 이 비었습니다 — 대사 품질이 떨어집니다`);
  if (!character.persona.occupation) problems.push(`${label}: persona.occupation 이 비었습니다`);

  return { ok: problems.length === 0, problems, character };
}

/**
 * 캐릭터 하나에 대해 어떤 시트를 export 해야 하는지 알려준다.
 * @param character parseCharacterJson 결과
 * @param need 게임이 실제로 쓰는 상태/이모트
 */
export function requiredSheets(character, { states = ['idle'], emotes = EMOTES } = {}) {
  const out = [];
  for (const s of states) {
    out.push({ kind: 'state', key: s, clipId: character.animation.states[s] || '', assigned: Boolean(character.animation.states[s]) });
  }
  for (const e of emotes) {
    out.push({ kind: 'emote', key: e, clipId: character.animation.emotes[e] || '', assigned: Boolean(character.animation.emotes[e]) });
  }
  return out;
}

/** 프레임 인덱스를 시간으로 구한다. 루프 재생. */
export function frameAt(sheet, elapsedMs) {
  const spf = 1000 / sheet.fps;
  return sheet.frames[Math.floor(elapsedMs / spf) % sheet.totalFrames];
}
