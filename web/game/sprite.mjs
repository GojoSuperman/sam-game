/**
 * SPUM Export 스프라이트 시트 렌더러.
 *
 * 읽는 것: <id>_<key>_sheet.png + <id>_<key>_sheet.json (SPUM Studio → Cast → Export)
 * sheet.json 스키마와 그리드 규칙은 src/spum-sheet.mjs 에 정리돼 있다.
 */
import { parseSheetMeta } from './spum-sheet.mjs';

const BASE = './assets/characters';

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`이미지 로드 실패: ${src}`));
    img.src = src;
  });
}

/**
 * 캐릭터 하나의 시트들을 모두 읽는다.
 * @returns {{ id, name, persona, sheets: Record<string,{img,sheet}>, problems: string[] }}
 */
export async function loadCharacter(id, keys) {
  const problems = [];
  const charRaw = await (await fetch(`${BASE}/${id}_character.json`)).json();

  const sheets = {};
  for (const key of keys) {
    try {
      const metaRaw = await (await fetch(`${BASE}/${id}_${key}_sheet.json`)).json();
      const parsed = parseSheetMeta(metaRaw, { label: `${id}_${key}_sheet.json` });
      if (!parsed.ok) { problems.push(...parsed.problems); continue; }
      const img = await loadImage(`${BASE}/${id}_${key}_sheet.png`);
      // PNG 실제 크기와 메타가 어긋나면 프레임이 조용히 밀린다 — 여기서 잡는다
      if (img.naturalWidth !== parsed.sheet.sheetWidth || img.naturalHeight !== parsed.sheet.sheetHeight) {
        problems.push(`${id}/${key}: PNG ${img.naturalWidth}x${img.naturalHeight} ≠ 메타 ${parsed.sheet.sheetWidth}x${parsed.sheet.sheetHeight}`);
        continue;
      }
      sheets[key] = { img, sheet: parsed.sheet };
    } catch (err) {
      problems.push(`${id}/${key}: ${err.message}`);
    }
  }
  return {
    id,
    name: charRaw.name || id,
    persona: charRaw.persona || {},
    isFixture: charRaw._fixture === true,
    sheets,
    problems,
  };
}

/** 한 프레임을 그린다. 픽셀아트이므로 스무딩을 끈다. */
export function drawSprite(ctx, entry, { x, y, scale = 2, elapsedMs = 0, flip = false }) {
  if (!entry) return;
  const { img, sheet } = entry;
  const spf = 1000 / sheet.fps;
  const f = sheet.frames[Math.floor(elapsedMs / spf) % sheet.totalFrames];
  const w = sheet.frameWidth * scale;
  const h = sheet.frameHeight * scale;
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  if (flip) {
    ctx.translate(x + w / 2, 0);
    ctx.scale(-1, 1);
    ctx.translate(-(x + w / 2), 0);
  }
  ctx.drawImage(img, f.sx, f.sy, f.w, f.h, Math.round(x), Math.round(y - h), w, h);
  ctx.restore();
}
