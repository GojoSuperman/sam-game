/**
 * 서버 스냅샷 → 로컬 복원.
 *
 * 왜 필요한가 (2026-08-20 사고): 브라우저 프로필의 localStorage 가 통째로 비었는데
 * 서버에는 rev 42 가 멀쩡히 남아 있었다. 이 상태로 Studio 를 새로고침하면
 * **빈 로컬이 서버를 덮어쓴다** (1-2 의 방향 규칙). 그 전에 되돌려야 한다.
 *
 * 사용: node scripts/studio-restore.mjs [--from <백업.json>] [--dry-run]
 *   기본은 서버(/api/studio/state)에서 가져온다. --from 을 주면 그 파일에서.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { withStudio, ensureSession, STUDIO_ORIGIN } from '../src/studio-browser.mjs';
import { createBackup } from '../src/studio-backup.mjs';

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : null; };
const fromFile = arg('--from');
const dryRun = args.includes('--dry-run');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

await withStudio({ headless: true }, async (ctx) => {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(`${STUDIO_ORIGIN}/studio/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.spumStudioData != null, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const s = await ensureSession(page);
  if (!s.loggedIn) throw new Error('로그인이 필요합니다.');
  console.log('세션 OK:', s.user?.email);

  // 지금 로컬 상태를 먼저 백업 (덮어쓰기 전 안전망)
  const before = await page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
  await mkdir('out/backups', { recursive: true });
  await writeFile(path.join('out', 'backups', `studio-before-restore-${stamp}.json`), JSON.stringify(createBackup(before, 'map'), null, 2), 'utf8');
  const bm = JSON.parse(before.sv_studio_maps_v1 || '[]');
  console.log(`현재 로컬: 키 ${Object.keys(before).length}개 · 맵 ${bm.length}개`);

  // 복원할 키 뭉치 준비
  let keys;
  if (fromFile) {
    keys = JSON.parse(await readFile(fromFile, 'utf8')).keys;
    console.log(`복원 원본: 파일 ${fromFile}`);
  } else {
    const server = await page.evaluate(async () => {
      const r = await fetch('/api/studio/state', { credentials: 'include' });
      const j = await r.json();
      return { keys: j?.state?.keys || j?.keys || null, rev: j?.revision ?? j?.rev ?? j?.state?.revision };
    });
    if (!server.keys) throw new Error('서버 상태에서 keys 를 못 읽었습니다.');
    keys = server.keys;
    console.log(`복원 원본: 서버 rev ${server.rev}`);
  }
  const maps = JSON.parse(keys.sv_studio_maps_v1 || '[]');
  const smo = JSON.parse(keys.sv_studio_smo_v1 || '[]');
  console.log(`복원 내용: 키 ${Object.keys(keys).length}개 · 맵 ${maps.length}개 (${maps.map((m) => m.name).join(', ')}) · SMO ${smo.length}개`);

  if (dryRun) { console.log('\n--dry-run: 아무것도 쓰지 않았습니다.'); return; }

  const r = await page.evaluate((k) => {
    for (const [key, val] of Object.entries(k)) {
      localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
      window.dispatchEvent(new CustomEvent('spum:studio-storage-write', { detail: { key, action: 'set' } }));
    }
    return { count: localStorage.length, maps: JSON.parse(localStorage.getItem('sv_studio_maps_v1') || '[]').map((m) => m.name) };
  }, keys);
  console.log(`로컬에 기록: 키 ${r.count}개 · 맵 ${r.maps.join(', ')}`);

  // 새로고침해서 앱이 제대로 읽는지 확인 (서버 저장은 하지 않는다 — 서버가 이미 원본이다)
  await page.goto(`${STUDIO_ORIGIN}/studio/?section=map`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('sv_studio_maps_v1') || '[]').map((m) => m.name));
  console.log('새로고침 후 맵:', after.join(', ') || '(없음)');
  await page.screenshot({ path: `out/restore-${stamp}.png` });
  console.log(`스크린샷: out/restore-${stamp}.png`);
});
