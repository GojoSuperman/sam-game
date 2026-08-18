#!/usr/bin/env node
/**
 * 자산 검증 — SPUM export(또는 fixture)가 게임이 기대하는 모양인지 확인한다.
 *
 *   node scripts/check-assets.mjs
 *
 * 확인:
 *   1. sheet.json ↔ sheet.png 짝이 맞는가
 *   2. PNG 헤더의 실제 크기가 sheet.json 의 sheetWidth/Height 와 같은가
 *      (여기가 어긋나면 렌더가 조용히 밀린다 — 가장 잡기 어려운 버그)
 *   3. 그리드 정합성 (totalFrames ≤ columns×rows 등)
 *   4. 캐릭터 JSON 의 persona 가 프롬프트에 쓸 만큼 채워졌는가
 *   5. 필요한 시트가 다 있는가
 *   6. fixture 가 아직 섞여 있는가
 */
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseSheetMeta, parseCharacterJson, requiredSheets } from '../web/game/spum-sheet.mjs';

const DIR = resolve('web/game/assets/characters');
const NEED_SHEETS = ['idle', 'walk', 'rest', 'thinking', 'surprised', 'proud', 'greet'];

/** PNG IHDR 에서 실제 픽셀 크기를 읽는다 (의존성 없이) */
function pngSize(buf) {
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (let i = 0; i < 8; i += 1) if (buf[i] !== sig[i]) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

let fail = 0; let warn = 0; let fixtures = 0;
const ok = (m) => console.log(`  \x1b[32mOK\x1b[0m   ${m}`);
const bad = (m) => { console.log(`  \x1b[31mFAIL\x1b[0m ${m}`); fail += 1; };
const wrn = (m) => { console.log(`  \x1b[33mWARN\x1b[0m ${m}`); warn += 1; };

let files;
try { files = await readdir(DIR); } catch {
  console.error(`자산 폴더가 없습니다: ${DIR}\n먼저 \`node scripts/make-fixture-assets.mjs\` 를 돌리거나 SPUM export 를 넣으세요.`);
  process.exit(1);
}

const castIds = files.filter((f) => f.endsWith('_character.json')).map((f) => f.replace('_character.json', ''));
if (!castIds.length) { console.error('character.json 이 없습니다.'); process.exit(1); }

console.log(`\n=== 자산 검증 — ${DIR} ===\n`);
console.log(`캐릭터 ${castIds.length}명: ${castIds.join(', ')}\n`);

for (const id of castIds) {
  console.log(`[${id}]`);

  // 캐릭터 JSON
  let character = null;
  try {
    const raw = JSON.parse(await readFile(resolve(DIR, `${id}_character.json`), 'utf8'));
    if (raw._fixture) fixtures += 1;
    const r = parseCharacterJson(raw, { label: `${id}_character.json` });
    character = r.character;
    if (r.ok) ok(`character.json — ${character.name} / ${character.persona.occupation} / ${character.persona.mbti}`);
    else for (const p of r.problems) wrn(p);
    if (character.persona.speechStyle) {
      console.log(`       말투: ${character.persona.speechStyle}`);
    }
  } catch (err) { bad(`${id}_character.json 읽기 실패: ${err.message}`); continue; }

  // 시트
  for (const key of NEED_SHEETS) {
    const jsonName = `${id}_${key}_sheet.json`;
    const pngName = `${id}_${key}_sheet.png`;
    if (!files.includes(jsonName) || !files.includes(pngName)) {
      const missing = [!files.includes(jsonName) && jsonName, !files.includes(pngName) && pngName].filter(Boolean);
      bad(`${key}: 파일 없음 — ${missing.join(', ')}`);
      continue;
    }
    let meta;
    try { meta = JSON.parse(await readFile(resolve(DIR, jsonName), 'utf8')); }
    catch (err) { bad(`${jsonName} 파싱 실패: ${err.message}`); continue; }
    if (meta._fixture) fixtures += 1;

    const r = parseSheetMeta(meta, { label: jsonName });
    if (!r.ok) { for (const p of r.problems) bad(p); continue; }
    const s = r.sheet;

    const png = pngSize(await readFile(resolve(DIR, pngName)));
    if (!png) { bad(`${pngName}: PNG 가 아닙니다`); continue; }
    if (png.width !== s.sheetWidth || png.height !== s.sheetHeight) {
      bad(`${key}: PNG 실제 ${png.width}x${png.height} ≠ sheet.json ${s.sheetWidth}x${s.sheetHeight} — 프레임이 밀립니다`);
      continue;
    }
    ok(`${key.padEnd(10)} ${s.totalFrames}프레임 ${s.frameWidth}x${s.frameHeight} ${s.columns}x${s.rows} ${s.fps}fps  PNG ${png.width}x${png.height} 일치`);
  }

  // 클립 배정 여부
  const need = requiredSheets(character, { states: ['idle', 'walk', 'rest'], emotes: ['thinking', 'surprised', 'proud', 'greet'] });
  const unassigned = need.filter((n) => !n.assigned).map((n) => `${n.kind}:${n.key}`);
  if (unassigned.length) wrn(`SPUM 에서 클립 미배정: ${unassigned.join(', ')} — Export 시 빈 시트가 나옵니다`);
  console.log('');
}

console.log('--- 요약 ---');
if (fixtures) {
  wrn(`fixture 파일 ${fixtures}개가 섞여 있습니다 — 아직 합성 자산입니다. SPUM Export 로 덮어쓰세요.`);
}
console.log(`  실패 ${fail} · 경고 ${warn}`);
console.log('');
process.exit(fail ? 1 : 0);
