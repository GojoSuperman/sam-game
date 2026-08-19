#!/usr/bin/env node
/**
 * 타일 id 고르는 표를 만든다 (out/tile-picker.html).
 *
 * 레이아웃 설정에 쓰는 숫자가 어느 그림인지 알 방법이 없으면 맵을 못 짠다.
 * 내장 타일셋 TP_Tile01.png 는 16×16 = 256장, tileIdBase 1 이라
 * id = 행×16 + 열 + 1 이다. 그 대응을 눈으로 보게 만든다.
 *
 * 테마 캐시(out/themes/spum-default.json)가 있으면 그 테마를, 없으면 내장
 * 타일셋을 보여준다. 테마 타일은 별칭·분류·이동 특성까지 함께 찍는다.
 *
 * 사용: node scripts/tile-picker.mjs && (브라우저로 out/tile-picker.html 열기)
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import {
  BUILTIN_TILESET_URL,
  BUILTIN_TILE_COLUMNS,
  BUILTIN_TILE_COUNT,
} from '../src/spum-map.mjs';
import { normalizeTheme } from '../src/spum-theme.mjs';

const SCALE = 2;
const TILE = 32;

let theme = null;
try {
  const raw = JSON.parse(await readFile(resolve('out/themes/spum-default.json'), 'utf8'));
  theme = normalizeTheme(raw.asset || raw, { aliases: raw.aliases || {} });
} catch { theme = null; }

function pngSize(dataUrl) {
  const comma = String(dataUrl || '').indexOf(',');
  if (comma < 0) return null;
  const bytes = Buffer.from(dataUrl.slice(comma + 1), 'base64');
  if (bytes.length < 24) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const themeSize = theme?.imageUrl ? pngSize(theme.imageUrl) : null;
const useTheme = Boolean(theme && themeSize);

const sheetUrl = useTheme ? theme.imageUrl : BUILTIN_TILESET_URL;
const columns = useTheme ? Math.floor(themeSize.width / theme.tileWidth) : BUILTIN_TILE_COLUMNS;
const rows = useTheme ? Math.ceil(theme.tiles.length / columns) : BUILTIN_TILE_COLUMNS;
const count = useTheme ? theme.tiles.length : BUILTIN_TILE_COUNT;
const firstId = useTheme ? theme.tileIdBase : 1;

const aliasOf = new Map();
if (useTheme) {
  for (const [alias, ids] of Object.entries(theme.aliases)) {
    for (const [n, id] of ids.entries()) {
      if (!aliasOf.has(id)) aliasOf.set(id, n === 0 ? alias : `${alias}:${n}`);
    }
  }
}

const cells = Array.from({ length: count }, (_, i) => {
  const id = firstId + i;
  const col = i % columns;
  const row = Math.floor(i / columns);
  const props = useTheme ? theme.tileProperties[String(id)] : null;
  const alias = aliasOf.get(id) || '';
  const label = useTheme ? (alias || String(id)) : String(id);
  const title = useTheme
    ? `${id} · ${props?.name || ''} · ${props?.category || ''} · ${props?.movement || ''}${alias ? ` · 별칭 "${alias}"` : ''}`
    : `타일 ${id} (행 ${row}, 열 ${col})`;
  const copy = useTheme && alias ? alias : String(id);
  const blocked = props?.blocksMovement === true ? ' blocked' : '';
  return `<button class="t${blocked}" data-copy="${copy}" data-id="${id}" title="${title}"
    style="background-position:-${col * TILE * SCALE}px -${row * TILE * SCALE}px"><span>${label}</span></button>`;
}).join('\n');

const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>SPUM 내장 타일셋 — 타일 id</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:24px; background:#14161a; color:#e6e8eb;
         font:14px/1.5 system-ui, -apple-system, "Noto Sans KR", sans-serif; }
  h1 { font-size:18px; margin:0 0 4px; }
  p { margin:0 0 16px; color:#9aa3ad; }
  code { background:#22262c; padding:1px 5px; border-radius:4px; }
  #grid { display:grid; grid-template-columns:repeat(${columns}, ${TILE * SCALE}px);
          gap:2px; width:max-content; }
  .t { width:${TILE * SCALE}px; height:${TILE * SCALE}px; padding:0; border:1px solid #2b3038;
       border-radius:2px; cursor:pointer; position:relative;
       background-image:url("${sheetUrl}");
       background-size:${TILE * SCALE * columns}px ${TILE * SCALE * rows}px;
       image-rendering:pixelated; }
  .t.blocked { border-color:#c05353; }
  .t:hover { outline:2px solid #ffcc4d; outline-offset:1px; z-index:1; }
  .t.sel { outline:2px solid #4dd08a; outline-offset:1px; z-index:1; }
  .t span { position:absolute; left:1px; bottom:1px; font-size:9px; line-height:1;
            padding:1px 2px; background:rgba(0,0,0,.66); color:#fff; border-radius:2px; }
  #bar { position:sticky; top:0; padding:10px 0 14px; background:#14161a; z-index:2; }
  #picked { font-weight:600; color:#4dd08a; }
</style></head><body>
<h1>${useTheme ? `${theme.name} — 맵 테마 타일` : 'SPUM 내장 타일셋 — 타일 id'}</h1>
<p>${useTheme
  ? `<code>${theme.assetId}</code> · 타일 ${count}장 · ${theme.tileWidth}px · <code>id = ${firstId} + 슬롯</code> · 빨간 테두리 = 통행 차단`
  : `<code>builtin_tp_tile01</code> · 16×16 = 256장 · 32px · <code>id = 행×16 + 열 + 1</code> · 0 은 빈 칸`}<br>
타일을 누르면 ${useTheme ? '별칭(없으면 id)' : 'id'} 이 복사됩니다. 레이아웃 설정의 <code>tiles</code> · <code>floor</code> · <code>wall</code> · <code>props[].tile</code> 에 넣으세요.</p>
<div id="bar">고른 타일: <span id="picked">—</span></div>
<div id="grid">
${cells}
</div>
<script>
  const picked = document.getElementById('picked');
  document.getElementById('grid').addEventListener('click', (event) => {
    const button = event.target.closest('.t');
    if (!button) return;
    document.querySelectorAll('.t.sel').forEach((el) => el.classList.remove('sel'));
    button.classList.add('sel');
    const value = button.dataset.copy || button.dataset.id;
    const shown = value + '  (id ' + button.dataset.id + ')';
    picked.textContent = shown;
    navigator.clipboard?.writeText(value).then(
      () => { picked.textContent = shown + ' — 복사됨'; },
      () => {}
    );
  });
</script>
</body></html>`;

const outPath = resolve('out/tile-picker.html');
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, html, 'utf8');
console.log(`[tile-picker] → ${outPath}`);
console.log(useTheme
  ? `  테마 "${theme.name}" 타일 ${count}장. 브라우저로 열면 됩니다.`
  : '  내장 타일셋 256장. `pnpm fetch-theme` 을 먼저 돌리면 맵 테마를 보여줍니다.');
