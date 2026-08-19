#!/usr/bin/env node
/**
 * 백업에서 테마의 에셋 id 를 찾아, 브라우저에서 그 이미지를 내려받는 스니펫을 만든다.
 *
 * 왜 필요한가 (실측):
 *   AI 로 만든 테마의 타일 이미지는 콘텐츠 해시 에셋 저장소(`/api/studio/assets`)로
 *   외부화되고, 백업에는 `assetId` 만 남는다. 게다가 맵에 붙여도 시트가 안 실린다 —
 *   `_stripBakedTilesetSheet` 가 `tiles[]` 가 비어 있지 않으면 `imageUrl` 을 지우기 때문이다.
 *   에셋 API 는 쿠키 세션이 필요해 여기서 직접 못 받는다. 그래서 브라우저에 심부름을 시킨다.
 *
 * 사용: node scripts/asset-snippet.mjs --backup <백업.json> [--theme "Custom SMO 2"]
 * 결과: out/<테마>-assets-snippet.js  (Studio 콘솔에 붙여넣기)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { readBackup, readKeyArray } from '../src/studio-backup.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const backupPath = arg('backup');
if (!backupPath) {
  console.error('사용법: node scripts/asset-snippet.mjs --backup <Studio백업.json> [--theme <이름>]');
  process.exit(1);
}

const backup = await readBackup(resolve(backupPath));
const smos = readKeyArray(backup, 'sv_studio_smo_v1');
const wanted = arg('theme');

const themes = smos
  .map((smo) => ({ smo, theme: smo?.mapTheme }))
  .filter((entry) => Array.isArray(entry.theme?.tiles) && entry.theme.tiles.length > 0)
  .filter((entry) => !wanted || entry.smo.name === wanted || entry.theme.id === wanted);

if (themes.length === 0) {
  console.error(`테마를 못 찾았습니다. 있는 것: ${smos.map((s) => s.name).join(', ')}`);
  process.exit(1);
}

for (const { smo, theme } of themes) {
  // 받을 것: ① AI 원본 참조 이미지(있으면 이것만으로 충분하다) ② 타일 조각들
  const refs = [];
  if (theme.sliceBaseAssetId) refs.push({ id: theme.sliceBaseAssetId, name: 'reference' });
  for (const input of Array.isArray(theme.aiInputs) ? theme.aiInputs : []) {
    if (input?.assetId && !refs.some((r) => r.id === input.assetId)) {
      refs.push({ id: input.assetId, name: String(input.label || 'ai-input').replace(/[^\w.-]+/g, '-') });
    }
  }
  const tiles = theme.tiles
    .map((tile, index) => ({ id: tile.assetId, name: `tile-${String(index + 1).padStart(2, '0')}-${String(tile.name || '').replace(/[^\w.-]+/g, '-')}` }))
    .filter((t) => t.id);

  const slug = String(smo.name || theme.id || 'theme').replace(/[^\w가-힣.-]+/g, '-');
  const snippet = `// SPUM Studio 콘솔에 붙여넣으세요 (F12 → Console)
// 테마 "${smo.name}" 의 이미지를 다운로드 폴더로 내려받습니다.
// 에셋 API 는 로그인 세션이 필요해서 브라우저에서만 됩니다.
(async () => {
  const items = ${JSON.stringify([...refs, ...tiles], null, 2).replace(/\n/g, '\n  ')};
  let ok = 0;
  for (const item of items) {
    try {
      const response = await fetch('/api/studio/assets/' + encodeURIComponent(item.id));
      if (!response.ok) { console.warn('[skip]', item.name, response.status); continue; }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '${slug}--' + item.name + '.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      ok += 1;
      await new Promise((r) => setTimeout(r, 350));   // 연속 다운로드를 브라우저가 막지 않게
    } catch (error) {
      console.warn('[fail]', item.name, error?.message);
    }
  }
  console.log('[assets] ' + ok + '/' + items.length + '장 내려받았습니다. 다운로드 폴더를 확인하세요.');
})();
`;

  const outPath = resolve(`out/${slug}-assets-snippet.js`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, snippet, 'utf8');
  console.log(`[asset-snippet] "${smo.name}" · 참조 ${refs.length}장 + 타일 ${tiles.length}장`);
  for (const item of [...refs, ...tiles]) console.log(`    ${item.name}  ${item.id.slice(0, 20)}…`);
  console.log(`  → ${outPath}`);
}
