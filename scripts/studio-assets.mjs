/**
 * 에셋 저장소에서 이미지를 직접 받아온다 — 문서 3-1 의 콘솔 스니펫 대체.
 *
 * 기존: 백업에서 assetId 를 찾아 콘솔 스니펫을 만들고, 사람이 크롬 콘솔에
 *       붙여넣어(`allow pasting` 타이핑까지 해서) 다운로드 폴더로 받았다.
 * 지금: 로그인 세션이 있는 브라우저에서 fetch 하면 끝난다.
 *
 * 사용: node scripts/studio-assets.mjs --theme "Custom SMO 2" [--backup <파일>]
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { withStudio, enterStudio, STUDIO_URL, STUDIO_ORIGIN } from '../src/studio-browser.mjs';

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : null; };
const themeName = arg('--theme');
const outDir = arg('--out') || path.join('out', 'assets-studio');

async function latestBackup() {
  // ★ 이름순 정렬은 안 된다 — studio-before-cleanup.json 같은 파일이 뒤로 와서
  //   오래된 백업을 집는다 (2026-08-20 실제로 그랬다). 수정 시각으로 고른다.
  const { stat } = await import('node:fs/promises');
  const files = [];
  for await (const f of glob('out/backups/studio-*.json')) files.push(f);
  if (!files.length) throw new Error('백업이 없습니다. `node scripts/studio-probe.mjs` 를 먼저 돌리세요.');
  const withTime = await Promise.all(files.map(async (f) => ({ f, t: (await stat(f)).mtimeMs })));
  return withTime.sort((a, b) => a.t - b.t).at(-1).f;
}

async function main() {
  const backupPath = arg('--backup') || (await latestBackup());
  const keys = JSON.parse(await readFile(backupPath, 'utf8')).keys;
  const smo = JSON.parse(keys.sv_studio_smo_v1 || '[]');

  const targets = smo.filter((o) => o.mapTheme && (!themeName || o.name === themeName));
  if (!targets.length) {
    console.error(`맵 테마가 없습니다${themeName ? ` (--theme "${themeName}")` : ''}.`);
    console.error('가진 테마:', smo.filter((o) => o.mapTheme).map((o) => o.name).join(', ') || '(없음)');
    process.exit(1);
  }

  // 받을 목록: 슬라이스 원본(1024²) + 타일별 이미지
  const jobs = [];
  for (const o of targets) {
    const t = o.mapTheme;
    const safe = o.name.replace(/[^\w가-힣-]+/g, '_');
    if (t.sliceBaseAssetId) jobs.push({ id: t.sliceBaseAssetId, file: `${safe}__source.png` });
    for (const tile of t.tiles || []) {
      if (tile.assetId) jobs.push({ id: tile.assetId, file: `${safe}__${String(tile.id).padStart(3, '0')}_${(tile.name || 'tile').replace(/[^\w-]+/g, '_')}.png` });
    }
  }
  console.log(`대상 테마: ${targets.map((t) => t.name).join(', ')} — 받을 에셋 ${jobs.length}개`);
  await mkdir(outDir, { recursive: true });

  return withStudio({ headless: true }, async (ctx) => {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await enterStudio(page);

    let ok = 0, fail = 0;
    for (const job of jobs) {
      // 페이지 안에서 fetch → 쿠키가 자동으로 붙는다. base64 로 받아 넘긴다.
      const res = await page.evaluate(async ({ origin, id }) => {
        const r = await fetch(`${origin}/api/studio/assets/${encodeURIComponent(id)}`, { credentials: 'include' });
        if (!r.ok) return { ok: false, status: r.status };
        const buf = await r.arrayBuffer();
        let bin = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { ok: true, status: r.status, type: r.headers.get('content-type'), b64: btoa(bin) };
      }, { origin: STUDIO_ORIGIN, id: job.id });

      if (!res.ok) { console.log(`  ✗ ${job.file} — HTTP ${res.status}`); fail++; continue; }
      const buf = Buffer.from(res.b64, 'base64');
      await writeFile(path.join(outDir, job.file), buf);
      console.log(`  ✓ ${job.file}  ${Math.round(buf.length / 1024)} KB  ${res.type || ''}`);
      ok++;
    }
    console.log('');
    console.log(`받음 ${ok}개 / 실패 ${fail}개 → ${outDir}`);
  });
}

main().catch((e) => { console.error('실패:', e.message); process.exit(1); });
