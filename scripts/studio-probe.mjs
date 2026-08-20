/**
 * SPUM Studio 정찰 — "무엇을 코드로 부를 수 있나" 를 지도로 만든다.
 *
 * 목적: DOM 클릭은 UI 가 바뀌면 깨진다. Studio 가 window 에 노출한 전역 함수를
 *       찾아내면 훨씬 안정적으로 조작할 수 있다. 이미 알려진 접점 하나
 *       (window.spumStudioData.saveServerSnapshot — src/studio-snippet.mjs)를
 *       실마리로, 같은 계열 전역을 전부 훑는다.
 *
 * 부작용 없음 — 읽기만 한다. 다만 시작할 때 백업을 먼저 받는다 (안전망).
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withStudio, enterStudio, STUDIO_URL } from '../src/studio-browser.mjs';
import { createBackup } from '../src/studio-backup.mjs';

const OUT = 'out';
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

async function main() {
  // withStudio 는 예외가 나도 반드시 컨텍스트를 닫는다 — 강제 종료로 쿠키가 날아간
  // 2026-08-20 사고의 재발 방지책이다.
  return withStudio({ headless: true }, async (ctx) => {
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`.slice(0, 300)));
  const requests = [];
  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/api/')) requests.push({ status: r.status(), method: r.request().method(), url: u.replace(/^https?:\/\/[^/]+/, '') });
  });

  // networkidle 은 오지 않는다 (Studio 가 계속 통신한다 — 2026-08-20 타임아웃 실측).
  // 앱이 준비된 진짜 신호는 전역이 붙는 시점이다.
  // enterStudio 가 세션 갱신·투어 제거·로컬 복원까지 처리한다
  const { session } = await enterStudio(page);
  console.log('세션 OK:', session.user?.email ?? '(사용자 정보 없음)');

  // ── 1. 백업 (안전망) ───────────────────────────────────────────────
  const ls = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out[k] = localStorage.getItem(k);
    }
    return out;
  });
  const backupPath = path.join(OUT, 'backups', `studio-${stamp}.json`);
  await writeFile(backupPath, JSON.stringify(createBackup(ls, 'map'), null, 2), 'utf8');
  const bytes = Object.values(ls).reduce((a, v) => a + v.length, 0);
  console.log(`백업: ${backupPath} (${Object.keys(ls).length}개 키, ${Math.round(bytes / 1024)} KB)`);

  // ── 2. 전역 탐색 ──────────────────────────────────────────────────
  const globals = await page.evaluate(() => {
    const describe = (v, depth) => {
      const t = typeof v;
      if (t === 'function') return `ƒ(${v.length})`;
      if (v === null) return 'null';
      if (t !== 'object') return t === 'string' ? `"${String(v).slice(0, 60)}"` : t;
      if (Array.isArray(v)) return `Array(${v.length})`;
      if (depth <= 0) return 'object';
      const o = {};
      for (const k of Object.keys(v).slice(0, 60)) {
        try { o[k] = describe(v[k], depth - 1); } catch { o[k] = '<접근 불가>'; }
      }
      // 프로토타입 메서드도 본다 (클래스 인스턴스인 경우)
      const proto = Object.getPrototypeOf(v);
      if (proto && proto !== Object.prototype) {
        for (const k of Object.getOwnPropertyNames(proto)) {
          if (k === 'constructor' || k in o) continue;
          try { if (typeof v[k] === 'function') o[k] = `ƒ(${v[k].length})`; } catch { /* getter 폭발 방지 */ }
        }
      }
      return o;
    };
    const found = {};
    for (const k of Object.getOwnPropertyNames(window)) {
      if (!/spum|studio/i.test(k)) continue;
      try { found[k] = describe(window[k], 2); } catch { found[k] = '<접근 불가>'; }
    }
    return found;
  });
  await writeFile(path.join(OUT, 'probe', `globals-${stamp}.json`), JSON.stringify(globals, null, 2), 'utf8');

  console.log('');
  console.log('=== window 전역 (spum|studio) ===');
  for (const [k, v] of Object.entries(globals)) {
    if (typeof v === 'string') { console.log(`  ${k} = ${v}`); continue; }
    const fns = Object.entries(v).filter(([, t]) => typeof t === 'string' && t.startsWith('ƒ'));
    const rest = Object.entries(v).filter(([, t]) => !(typeof t === 'string' && t.startsWith('ƒ')));
    console.log(`  ${k}  — 함수 ${fns.length}개, 그 밖 ${rest.length}개`);
    for (const [n, sig] of fns) console.log(`      ${n}${sig.slice(1)}`);
  }

  // ── 3. 초기 로드가 부른 API ────────────────────────────────────────
  console.log('');
  console.log('=== 대시보드 로드 중 호출된 /api/* ===');
  const seen = new Set();
  for (const r of requests) {
    const key = `${r.method} ${r.url.split('?')[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`  ${String(r.status).padEnd(4)} ${key}`);
  }

  await writeFile(path.join(OUT, 'probe', `requests-${stamp}.json`), JSON.stringify(requests, null, 2), 'utf8');
  console.log('');
  console.log('결과:', path.join(OUT, 'probe'));
  });
}

main().catch((e) => { console.error('실패:', e.message); process.exit(1); });
