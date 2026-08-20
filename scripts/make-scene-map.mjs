#!/usr/bin/env node
/**
 * "이런 느낌으로 맵 만들어줘" 한 방 — 창을 띄운 채 전 과정을 잇는다.
 *
 *   ① 씬 조감도 생성 (AI)        ② 참조본 512 축소
 *   ③ 통행 마스크 생성 (img2img) ④ 마스크로 통행 판정 + 고립 구역 잇기
 *   ⑤ 맵 레코드 생성             ⑥ Studio 에 주입 + 확인 스크린샷
 *
 * 창 하나로 이어서 하므로 사람이 전 과정을 지켜볼 수 있다 (--headed).
 * 각 단계는 이미 따로따로 검증된 것들이다 (문서 9절·10절).
 *
 * 사용:
 *   node scripts/make-scene-map.mjs --name "중세 대장간" --prompt-file <파일> --headed --record
 *   node scripts/make-scene-map.mjs --name "..." --prompt-text "..." --headed
 *   ... --dry-run   그림만 만들고 주입은 하지 않는다
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { withStudio, enterStudio, STUDIO_ORIGIN } from '../src/studio-browser.mjs';
import { createBackup } from '../src/studio-backup.mjs';
import { decodePng, Canvas } from '../src/png.mjs';
import { attachImageCapture, createAndOpenTheme, setupTheme, applySource, generate } from '../src/studio-scene.mjs';

const args = process.argv.slice(2);
const arg = (n, d = null) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : d; };
const has = (n) => args.includes(n);

const mapName = arg('--name');
const promptFile = arg('--prompt-file');
const promptText = arg('--prompt-text');
const headed = has('--headed');
const record = has('--record');
const dryRun = has('--dry-run');
const jpegQ = arg('--jpeg', '68');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

if (!mapName || (!promptFile && !promptText)) {
  console.error('사용법: node scripts/make-scene-map.mjs --name "<맵 이름>" (--prompt-file <파일> | --prompt-text "<문장>") [--headed] [--record] [--dry-run]');
  process.exit(1);
}

const MASK_PROMPT = `Convert the reference floor plan into a flat two-tone navigation mask, same layout and same grid alignment.
Pure WHITE for every walkable floor tile a person can stand on.
Pure BLACK for everything blocked: walls, furniture, machinery, beds, tables, chairs, counters, crates, barrels, stairs, plants, fireplaces.
Hard edges, no anti-aliasing, no grey, no gradients, no shadows, no text, no icons.
Keep the exact same shapes and positions as the reference. Square image on a 32x32 grid.`;

const safe = (s) => s.replace(/[^\w가-힣-]+/g, '_');
const step = (n, msg) => console.log(`\n[${n}/6] ${msg}`);

/** 1024² → 512² (참조 이미지가 크면 413 이 난다) */
async function halve(srcPath, outPath) {
  const src = decodePng(await readFile(srcPath));
  const S = 2, w = src.width / S, h = src.height / S;
  const c = new Canvas(w, h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < S; dy += 1) for (let dx = 0; dx < S; dx += 1) {
      const i = ((y * S + dy) * src.width + (x * S + dx)) * 4;
      r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2];
    }
    const n = S * S;
    c.set(x, y, [Math.round(r / n), Math.round(g / n), Math.round(b / n), 255]);
  }
  const buf = c.toPng();
  await writeFile(outPath, buf);
  return Math.round(buf.length / 1024);
}

const text = promptText || (await readFile(promptFile, 'utf8')).trim();
console.log(`맵 "${mapName}" · 프롬프트 ${text.length}자${text.length > 520 ? '  ⚠ 520자를 넘으면 504 가 나기 쉽습니다' : ''}`);

await withStudio({ headless: !headed, ...(record ? { recordDir: 'out/videos' } : {}) }, async (ctx) => {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const capture = await attachImageCapture(page);

  await enterStudio(page, { section: 'object' });

  // 백업 먼저
  const ls = await page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i += 1) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
  await mkdir('out/backups', { recursive: true });
  await writeFile(path.join('out', 'backups', `studio-${stamp}.json`), JSON.stringify(createBackup(ls, 'object'), null, 2), 'utf8');

  // ── ① 씬 ──────────────────────────────────────────────
  step(1, `씬 조감도 생성 — "${mapName}"`);
  let ed = await createAndOpenTheme(page);
  await setupTheme(page, ed, { name: mapName, promptText: text, tags: `scene, 32x32, ${mapName}` });
  const scenePath = path.join('out', 'assets-studio', `${safe(mapName)}__scene-${stamp}.png`);
  if (!(await generate(page, ed, capture, scenePath))) {
    throw new Error('씬 생성 실패 — 504 이거나 응답에 이미지가 없습니다. 프롬프트를 줄여 다시 시도하세요.');
  }

  // ── ② 참조본 ──────────────────────────────────────────
  step(2, '참조본 512² 로 축소 (1024² 를 그대로 올리면 413)');
  const refPath = path.join('out', 'assets-studio', `${safe(mapName)}__ref512-${stamp}.png`);
  console.log(`  ${await halve(scenePath, refPath)}KB → ${refPath}`);

  // ── ③ 마스크 ──────────────────────────────────────────
  step(3, '통행 마스크 생성 (img2img — 구조를 유지시킨다)');
  ed = await createAndOpenTheme(page);
  await setupTheme(page, ed, { name: `${mapName} 마스크`, promptText: MASK_PROMPT, tags: 'mask, 32x32' });
  await applySource(page, ed, refPath);
  const maskPath = path.join('out', 'assets-studio', `${safe(mapName)}__mask-${stamp}.png`);
  if (!(await generate(page, ed, capture, maskPath))) {
    throw new Error('마스크 생성 실패 — 씬은 남아 있으니 마스크만 다시 뽑으면 됩니다.');
  }

  // ── ④⑤ 맵 레코드 ─────────────────────────────────────
  step(4, '마스크로 통행 판정 · 고립 구역 잇기 · 맵 레코드 생성');
  const outJson = path.join('out', `scene-map-${safe(mapName)}.json`);
  const res = execFileSync(process.execPath, [
    'scripts/scene-to-map.mjs', '--image', scenePath, '--maskimage', maskPath,
    '--name', mapName, '--jpeg', String(jpegQ), '--connect', '--mask', '--out', outJson,
  ], { encoding: 'utf8' });
  process.stdout.write(res.split('\n').map((l) => (l ? '  ' + l : l)).join('\n'));

  if (dryRun) { console.log('\n--dry-run: 주입하지 않았습니다.'); return; }

  // ── ⑥ 주입 ────────────────────────────────────────────
  step(5, 'Studio 에 주입');
  const record0 = JSON.parse(await readFile(outJson, 'utf8'));
  const applied = await page.evaluate(async (m) => {
    const KEY = 'sv_studio_maps_v1';
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    const at = list.findIndex((x) => x.name === m.name);
    if (at > -1) { m.id = list[at].id; m.meta = { ...m.meta, createdAt: list[at].meta?.createdAt }; list[at] = m; }
    else list.unshift(m);
    try { localStorage.setItem(KEY, JSON.stringify(list)); }
    catch (e) { return { error: String(e).slice(0, 120) }; }
    window.dispatchEvent(new CustomEvent('spum:studio-storage-write', { detail: { key: KEY, action: 'set' } }));
    const saved = await window.spumStudioData?.saveServerSnapshot?.('scene-map');
    return { names: list.map((x) => x.name), saved };
  }, record0);
  if (applied.error) throw new Error(`주입 실패(저장소 한도일 수 있습니다): ${applied.error}`);
  console.log(`  맵 ${applied.names.length}개: ${applied.names.join(', ')}`);
  console.log(`  saveServerSnapshot → ${applied.saved}`);

  step(6, '새로고침하고 확인');
  await page.goto(`${STUDIO_ORIGIN}/studio/?section=map`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000);
  await page.locator(`text=${mapName}`).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(4000);
  for (const [x, y] of [[1018, 511], [1018, 537]]) { await page.mouse.click(x, y); await page.waitForTimeout(800); }
  await page.waitForTimeout(2500);
  const shot = path.join('out', `scene-final-${safe(mapName)}.png`);
  await page.screenshot({ path: shot });
  console.log(`  스크린샷: ${shot}`);
  console.log(`\n완료 — "${mapName}"`);
});
