/**
 * 맵 레코드 → 미리보기 HTML.
 *
 * Studio 에 넣기 전에 눈으로 확인하는 용도. 타일 그림은 SPUM 이 서빙하는
 * 내장 타일셋을 그대로 참조하므로, 여기서 보이는 것이 Studio 에서 보일 것과
 * 같은 타일이다 (렌더 순서·카메라까지 같지는 않다).
 */
import {
  BUILTIN_TILESET_URL,
  BUILTIN_TILE_COLUMNS,
  NAV_ON,
  idx,
} from './spum-map.mjs';
import { themeForTileId } from './spum-theme.mjs';
import { roleCss, binaryCss, legendHtml, LEGEND_CSS } from './roles.mjs';

/** data URL PNG 의 IHDR 에서 가로세로를 읽는다 (의존성 없이) */
function readPngSize(dataUrl) {
  const comma = String(dataUrl || '').indexOf(',');
  if (comma < 0) return null;
  const bytes = Buffer.from(dataUrl.slice(comma + 1), 'base64');
  if (bytes.length < 24 || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export function renderPreviewHtml(record, { scale = 1, theme = null } = {}) {
  const tile = record.tileSize;
  const px = tile * scale;

  // 테마는 여러 개일 수 있다 (id 대역 2049 · 4097 · 6145 …).
  // 타일마다 어느 시트에서 잘라올지 달라지므로 시트별 CSS 클래스를 만든다.
  const themeList = (Array.isArray(theme?.themes) ? theme.themes : (theme ? [theme] : []))
    .map((entry, index) => {
      // JPEG 시트는 PNG 헤더로 크기를 못 읽는다. 생성 때 기록해둔 값을 먼저 쓴다.
      const size = (entry.sheetWidth && entry.sheetHeight)
        ? { width: entry.sheetWidth, height: entry.sheetHeight }
        : readPngSize(entry.imageUrl);
      if (!size) return null;
      return {
        cls: `s${index}`,
        base: entry.tileIdBase,
        url: entry.imageUrl,
        columns: Math.max(1, Math.floor(size.width / entry.tileWidth)),
        sheetW: (size.width * scale * tile) / entry.tileWidth,
        sheetH: (size.height * scale * tile) / entry.tileHeight,
        name: entry.name,
      };
    })
    .filter(Boolean);

  const builtin = {
    cls: 'sb',
    base: 1,
    url: BUILTIN_TILESET_URL,
    columns: BUILTIN_TILE_COLUMNS,
    sheetW: tile * BUILTIN_TILE_COLUMNS * scale,
    sheetH: tile * BUILTIN_TILE_COLUMNS * scale,
    name: '내장 TP_Tile01',
  };
  const sheets = themeList.length > 0 ? themeList : [builtin];

  function sheetFor(id) {
    if (themeList.length === 0) return builtin;
    const owner = themeForTileId(theme, id);
    if (owner) {
      const found = sheets.find((s) => s.base === owner.tileIdBase);
      if (found) return found;
    }
    return id < 2049 ? builtin : sheets[0];
  }

  const drawLayer = (layer) => {
    const cells = [];
    for (let row = 0; row < record.height; row += 1) {
      for (let col = 0; col < record.width; col += 1) {
        const id = layer.data[idx(record.width, col, row)];
        if (!id) continue;
        const sheet = sheetFor(id);
        const local = id - sheet.base;
        if (local < 0) continue;
        const sx = (local % sheet.columns) * px;
        const sy = Math.floor(local / sheet.columns) * px;
        cells.push(`<i class="${sheet.cls}" style="left:${col * px}px;top:${row * px}px;background-position:-${sx}px -${sy}px"></i>`);
      }
    }
    return `<div class="layer" data-layer="${layer.name}">${cells.join('')}</div>`;
  };

  const tileLayers = record.layers
    .filter((l) => l.type === 'back' || l.type === 'front')
    .map(drawLayer)
    .join('\n');

  // 역할별 오버레이 — 테마의 tileProperties.roleHint 로 "왜 막혔는지"까지 보여준다.
  // 힌트가 없는 맵(레이아웃 DSL 로 만든 것)은 walkable/obstacle 2색으로만 보인다.
  const roleOf = (id) => {
    const owner = themeForTileId(theme, id) || theme;
    return owner?.tileProperties?.[String(id)]?.roleHint || null;
  };
  const backLayer = record.layers.find((l) => l.name === 'back_1');
  const walkLayer = record.layers.find((l) => l.name === 'walkable');
  let hasRoles = false;
  const roleCells = [];
  if (backLayer) {
    for (let row = 0; row < record.height; row += 1) {
      for (let col = 0; col < record.width; col += 1) {
        const at = idx(record.width, col, row);
        let r = roleOf(backLayer.data[at]);
        if (!r) {
          r = walkLayer && walkLayer.data[at] === NAV_ON ? 'floor' : 'blocked';
        } else {
          hasRoles = true;
        }
        roleCells.push(`<i data-r="${r}" style="left:${col * px}px;top:${row * px}px"></i>`);
      }
    }
  }
  const roleLayer = `<div class="layer roles off" id="roles">${roleCells.join('')}</div>`;

  const nav = (name, className) => {
    const layer = record.layers.find((l) => l.name === name);
    if (!layer) return '';
    const cells = [];
    for (let row = 0; row < record.height; row += 1) {
      for (let col = 0; col < record.width; col += 1) {
        if (layer.data[idx(record.width, col, row)] !== NAV_ON) continue;
        cells.push(`<i style="left:${col * px}px;top:${row * px}px"></i>`);
      }
    }
    return `<div class="layer nav ${className}" data-layer="${name}">${cells.join('')}</div>`;
  };

  const objects = record.objects.map((object) => {
    const r = object.rect;
    return `<div class="obj" style="left:${r.col * px}px;top:${r.row * px}px;width:${r.width * px}px;height:${r.height * px}px;${object.color ? `--c:${object.color}` : ''}"><b>${object.name}</b></div>`;
  }).join('');

  const spawns = record.spawnPoints.map((p) => (
    `<div class="spawn" style="left:${p.x * px}px;top:${p.y * px}px"><b>${p.label || ''}</b></div>`
  )).join('');

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>${record.name} — 맵 미리보기</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:20px; background:#14161a; color:#e6e8eb;
         font:14px/1.5 system-ui, -apple-system, "Noto Sans KR", sans-serif; }
  h1 { font-size:17px; margin:0 0 2px; }
  .meta { color:#9aa3ad; margin:0 0 12px; }
  #bar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:8px; }
  button { background:#22262c; color:#e6e8eb; border:1px solid #343a42; border-radius:6px;
           padding:5px 11px; cursor:pointer; font:inherit; }
  button.on { outline:2px solid #ffcc4d; }
  button[disabled] { opacity:.4; cursor:default; }
  label { display:flex; gap:5px; align-items:center; cursor:pointer; user-select:none; }
  #stage { position:relative; width:${record.width * px}px; height:${record.height * px}px;
           background:#0b0d10; outline:1px solid #2b3038; }
  .layer { position:absolute; inset:0; }
  .layer i { position:absolute; width:${px}px; height:${px}px; image-rendering:pixelated; }
${sheets.map((s) => `  .${s.cls} { background-image:url("${s.url}"); background-size:${s.sheetW}px ${s.sheetH}px; }`).join('\n')}
  .nav i { background:none; }
  .nav.walk i { background:rgba(90,230,140,.30); }
  .nav.block i { background:rgba(240,70,70,.45); }
  .roles i { position:absolute; width:${px}px; height:${px}px; }
${roleCss('.roles i')}
  .roles.binary i { background:none; }
${binaryCss('.roles.binary i')}
${LEGEND_CSS}
  .obj { position:absolute; border:1px dashed var(--c,#ffcc4d); pointer-events:none; }
  .obj b { position:absolute; left:2px; top:2px; font-size:10px; font-weight:600;
           padding:1px 4px; border-radius:3px; background:rgba(0,0,0,.62); color:var(--c,#ffcc4d); }
  .spawn { position:absolute; width:${px}px; height:${px}px; box-sizing:border-box;
           border:2px solid #63b3ff; border-radius:50%; }
  .spawn b { position:absolute; left:50%; top:100%; transform:translateX(-50%);
             font-size:10px; white-space:nowrap; padding:1px 4px; border-radius:3px;
             background:rgba(0,0,0,.7); color:#9ecbff; }
  .off { display:none; }
</style></head><body>
<h1>${record.name}</h1>
<p class="meta">${record.width}×${record.height} 타일 · ${record.tileSize}px · 레이어 ${record.layers.length} · 구역 ${record.objects.length} · 스폰 ${record.spawnPoints.length}
 · 타일셋 ${sheets.map((s) => `${s.name}(id ${s.base}~)`).join(' + ')}<br>${record.description || ''}</p>
<div id="bar">
  <span>오버레이:</span>
  <button data-ov="none" class="on">없음</button>
  <button data-ov="binary">통행 / 막힘</button>
  <button data-ov="roles"${hasRoles ? '' : ' disabled title="이 맵에는 역할 정보가 없습니다"'}>종류별</button>
  <label><input type="checkbox" data-t="obj" checked> 구역 이름</label>
  <label><input type="checkbox" data-t="spawn" checked> 스폰</label>
</div>
<p class="meta"><b>흐린 색 = 지나갈 수 있음 · 진한 색 = 막힘.</b> ${legendHtml()}</p>
<div id="stage">
${tileLayers}
${roleLayer}
<div class="wrap-obj">${objects}</div>
<div class="wrap-spawn">${spawns}</div>
</div>
<script>
  const map = { obj:'.wrap-obj', spawn:'.wrap-spawn' };
  const apply = (key, on) => document.querySelectorAll(map[key])
    .forEach((el) => el.classList.toggle('off', !on));
  document.querySelectorAll('#bar input[data-t]').forEach((input) => {
    apply(input.dataset.t, input.checked);
    input.addEventListener('change', () => apply(input.dataset.t, input.checked));
  });
  const roles = document.getElementById('roles');
  for (const b of document.querySelectorAll('[data-ov]')) {
    b.addEventListener('click', () => {
      document.querySelectorAll('[data-ov]').forEach((x) => x.classList.toggle('on', x === b));
      roles.classList.toggle('off', b.dataset.ov === 'none');
      roles.classList.toggle('binary', b.dataset.ov === 'binary');
    });
  }
</script>
</body></html>`;
}
