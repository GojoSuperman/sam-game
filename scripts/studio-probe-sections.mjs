/**
 * 섹션별 정찰 — Object/Map/Cast/World 에 들어가면 무엇이 새로 붙나.
 *
 * 대시보드 전역만으로는 조작할 수 없다 (studio-probe.mjs 결과).
 * 각 에디터가 로드될 때 붙는 전역·DOM 접점·API 를 섹션마다 기록한다.
 * 읽기 전용 — 클릭은 좌측 네비 이동뿐이고 저장·생성은 하지 않는다.
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withStudio, enterStudio, STUDIO_URL } from '../src/studio-browser.mjs';

const OUT = path.join('out', 'probe');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const SECTIONS = ['Home', 'World', 'Map', 'Object', 'Cast'];

/** 전역 이름 목록 (값이 아니라 '무엇이 있나') */
const listGlobals = (page) => page.evaluate(() =>
  Object.getOwnPropertyNames(window).filter((k) => /spum|studio/i.test(k)).sort());

/** 전역 하나의 모양 */
const describeGlobal = (page, name) => page.evaluate((n) => {
  const v = window[n];
  const t = typeof v;
  if (t === 'function') return { kind: 'function', arity: v.length };
  if (v === null || t !== 'object') return { kind: t, value: String(v).slice(0, 80) };
  if (Array.isArray(v)) return { kind: 'array', length: v.length };
  const methods = [], fields = [];
  const push = (k, o) => {
    try { (typeof o[k] === 'function' ? methods : fields).push(typeof o[k] === 'function' ? `${k}(${o[k].length})` : k); }
    catch { fields.push(`${k}<접근불가>`); }
  };
  for (const k of Object.keys(v)) push(k, v);
  const proto = Object.getPrototypeOf(v);
  if (proto && proto !== Object.prototype) {
    for (const k of Object.getOwnPropertyNames(proto)) {
      if (k === 'constructor') continue;
      try { if (typeof v[k] === 'function') methods.push(`${k}(${v[k].length})`); } catch { /* getter 회피 */ }
    }
  }
  return { kind: 'object', methods, fields: fields.slice(0, 40) };
}, name);

/** 조작 접점이 될 만한 DOM 요소 */
const domProbe = (page) => page.evaluate(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const txt = (e) => (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const dataAttrs = new Map();
  for (const e of document.querySelectorAll('*')) {
    for (const a of e.attributes) {
      if (!a.name.startsWith('data-')) continue;
      if (!dataAttrs.has(a.name)) dataAttrs.set(a.name, new Set());
      if (dataAttrs.get(a.name).size < 8) dataAttrs.get(a.name).add(a.value.slice(0, 30));
    }
  }
  return {
    buttons: [...document.querySelectorAll('button')].filter(vis).map(txt).filter(Boolean).slice(0, 60),
    inputs: [...document.querySelectorAll('input,select,textarea')].filter(vis)
      .map((e) => `${e.tagName.toLowerCase()}[${e.type || ''}] ${e.getAttribute('placeholder') || e.getAttribute('aria-label') || e.name || e.id || ''}`.trim()).slice(0, 40),
    canvases: [...document.querySelectorAll('canvas')].map((c) => `${c.width}x${c.height} ${c.className || ''}`.trim()).slice(0, 10),
    dataAttrs: Object.fromEntries([...dataAttrs].slice(0, 25).map(([k, v]) => [k, [...v]])),
  };
});

async function main() {
  return withStudio({ headless: true }, async (ctx) => {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    const api = [];
    page.on('response', (r) => {
      const u = r.url();
      if (u.includes('/api/')) api.push({ section: current, status: r.status(), method: r.request().method(), url: u.replace(/^https?:\/\/[^/]+/, '').split('?')[0] });
    });
    let current = 'boot';

    await page.goto(STUDIO_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.spumStudioData != null, { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const session = await ensureSession(page);
    if (!session.loggedIn) throw new Error('세션을 되살리지 못했습니다 — SSO 쿠키까지 만료됐습니다. `npm run studio-login` 을 실행하세요.');
    console.log('세션 OK:', session.user?.email);

    const report = {};
    let known = new Set(await listGlobals(page));
    console.log(`기준(대시보드) 전역 ${known.size}개`);

    for (const name of SECTIONS) {
      current = name;
      // 좌측 네비 버튼 — 접근 가능한 이름으로 찾는다 (좌표보다 덜 깨진다)
      const nav = page.locator(`button:has-text("${name}"), [role="button"]:has-text("${name}")`).first();
      try {
        await nav.click({ timeout: 8000 });
      } catch {
        console.log(`  ${name}: 네비 버튼을 못 찾았습니다 — 건너뜁니다`);
        continue;
      }
      await page.waitForTimeout(5000); // 에디터 로드 대기

      const now = await listGlobals(page);
      const fresh = now.filter((k) => !known.has(k));
      const detail = {};
      for (const g of fresh) detail[g] = await describeGlobal(page, g);
      const dom = await domProbe(page);
      report[name] = { newGlobals: fresh, detail, dom, url: page.url() };
      fresh.forEach((k) => known.add(k));

      const shot = path.join(OUT, `section-${name}-${stamp}.png`);
      await page.screenshot({ path: shot });

      console.log('');
      console.log(`── ${name} ────────────────────────────────`);
      console.log(`  새 전역 ${fresh.length}개${fresh.length ? ': ' + fresh.join(', ') : ''}`);
      for (const [g, d] of Object.entries(detail)) {
        if (d.kind === 'object' && d.methods?.length) console.log(`      ${g}: ${d.methods.slice(0, 14).join(' ')}${d.methods.length > 14 ? ` …+${d.methods.length - 14}` : ''}`);
        else console.log(`      ${g}: ${d.kind}${d.arity != null ? `(${d.arity})` : ''}${d.length != null ? `[${d.length}]` : ''}`);
      }
      console.log(`  버튼 ${dom.buttons.length} · 입력 ${dom.inputs.length} · canvas ${dom.canvases.length}`);
      if (dom.buttons.length) console.log(`      버튼: ${dom.buttons.slice(0, 18).join(' | ')}`);
      if (dom.canvases.length) console.log(`      canvas: ${dom.canvases.join(' , ')}`);
      const keys = Object.keys(dom.dataAttrs);
      if (keys.length) console.log(`      data-*: ${keys.slice(0, 12).join(', ')}`);
    }

    await writeFile(path.join(OUT, `sections-${stamp}.json`), JSON.stringify({ report, api }, null, 2), 'utf8');
    console.log('');
    console.log('=== 섹션별 API 호출 ===');
    const seen = new Set();
    for (const r of api) {
      const k = `${r.section} ${r.method} ${r.url}`;
      if (seen.has(k) || r.section === 'boot') continue;
      seen.add(k);
      console.log(`  ${r.section.padEnd(7)} ${String(r.status).padEnd(4)} ${r.method} ${r.url}`);
    }
    console.log('');
    console.log('결과:', path.join(OUT, `sections-${stamp}.json`));
  });
}

main().catch((e) => { console.error('실패:', e.message); process.exit(1); });
