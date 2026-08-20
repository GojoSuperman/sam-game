/**
 * Object(맵 테마) 에디터 정찰 — AI 생성 파이프라인의 조작 접점을 찾는다.
 *
 * 목표: 테마 이름 · Concept · Reference Prompt · 모델/품질 · GRID/TARGET ·
 *       Generate/Slice/Classify 버튼의 안정적인 셀렉터.
 * 읽기 전용 — 기존 테마를 열어 화면 구조만 본다. 생성·저장은 하지 않는다.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withStudio, ensureSession, STUDIO_ORIGIN } from '../src/studio-browser.mjs';

const OUT = path.join('out', 'probe');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const target = process.argv.includes('--theme') ? process.argv[process.argv.indexOf('--theme') + 1] : 'Custom SMO 2';

/** 조작 가능한 요소를 셀렉터 후보와 함께 뽑는다 */
const probeFrame = (frame) => frame.evaluate(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const txt = (e) => (e.innerText || e.value || '').replace(/\s+/g, ' ').trim().slice(0, 45);
  const sel = (e) => {
    for (const a of e.attributes) if (a.name.startsWith('data-')) return `[${a.name}${a.value ? `="${a.value}"` : ''}]`;
    if (e.id) return `#${e.id}`;
    if (e.getAttribute('aria-label')) return `[aria-label="${e.getAttribute('aria-label')}"]`;
    if (e.name) return `[name="${e.name}"]`;
    if (e.placeholder) return `[placeholder="${e.placeholder}"]`;
    return e.className ? `.${String(e.className).split(/\s+/).filter(Boolean).slice(0, 2).join('.')}` : e.tagName.toLowerCase();
  };
  const rect = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
  return {
    buttons: [...document.querySelectorAll('button,[role="button"]')].filter(vis).map((e) => ({ text: txt(e), sel: sel(e), at: rect(e) })).slice(0, 80),
    inputs: [...document.querySelectorAll('input,select,textarea')].filter(vis).map((e) => ({
      tag: e.tagName.toLowerCase(), type: e.type || '', sel: sel(e),
      label: e.getAttribute('aria-label') || e.placeholder || e.name || e.id || '',
      value: String(e.value || '').slice(0, 60),
      options: e.tagName === 'SELECT' ? [...e.options].map((o) => o.text).slice(0, 12) : undefined,
      at: rect(e),
    })).slice(0, 60),
    headings: [...document.querySelectorAll('h1,h2,h3,h4,label,legend')].filter(vis).map(txt).filter(Boolean).slice(0, 60),
    url: location.href,
  };
});

/** 페이지의 모든 프레임을 훑는다 — 에디터가 iframe 안이면 page.evaluate 로는 안 보인다 */
async function probe(page) {
  const frames = page.frames();
  const out = { frames: frames.length, buttons: [], inputs: [], headings: [] };
  for (const f of frames) {
    try {
      const r = await probeFrame(f);
      out.buttons.push(...r.buttons); out.inputs.push(...r.inputs); out.headings.push(...r.headings);
    } catch { /* 크로스오리진 프레임은 건너뛴다 */ }
  }
  return out;
}

await withStudio({ headless: true }, async (ctx) => {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(`${STUDIO_ORIGIN}/studio/?section=object`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.spumStudioData != null, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(6000);
  const s = await ensureSession(page);
  if (!s.loggedIn) throw new Error('세션을 되살리지 못했습니다 — SSO 쿠키까지 만료됐습니다. `npm run studio-login` 을 실행하세요.');
  console.log('세션 OK:', s.user?.email);

  const before = await probe(page);
  console.log(`목록 화면 — 버튼 ${before.buttons.length} · 입력 ${before.inputs.length}`);
  await page.screenshot({ path: path.join(OUT, `object-list-${stamp}.png`) });

  console.log(`\n"${target}" 을 엽니다…`);
  await page.locator(`text=${target}`).first().click({ timeout: 10000 });
  await page.waitForTimeout(6000);

  const after = await probe(page);
  await page.screenshot({ path: path.join(OUT, `object-editor-${stamp}.png`), fullPage: false });
  await writeFile(path.join(OUT, `object-${stamp}.json`), JSON.stringify({ before, after }, null, 2), 'utf8');

  console.log(`\n=== 편집 화면 ===`);
  console.log(`제목/라벨: ${after.headings.join(' | ')}`);
  console.log(`\n버튼 ${after.buttons.length}개:`);
  for (const b of after.buttons) if (b.text) console.log(`  "${b.text}"  ${b.sel}  @${b.at.slice(0, 2)}`);
  console.log(`\n입력 ${after.inputs.length}개:`);
  for (const i of after.inputs) {
    console.log(`  ${i.tag}[${i.type}] ${i.label ? `"${i.label}" ` : ''}${i.sel}  값="${i.value}"${i.options ? ` 선택지=${i.options.join('/')}` : ''}`);
  }
  console.log(`\n스크린샷: ${path.join(OUT, `object-editor-${stamp}.png`)}`);
});
