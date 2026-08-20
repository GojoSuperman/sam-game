/**
 * Studio Object 에디터의 AI 타일 생성을 코드로 몬다.
 *
 * 문서 2-1 에서 "Studio 만 할 수 있는 것" 으로 분류됐던 기능이다
 * (`/api/ai-tiles/generate` 는 쿠키 세션이 필요하고 클라이언트 API 키 경로가 없다).
 * 브라우저를 직접 몰면 그 제약이 사라진다.
 *
 * ★ --generate 는 **실제로 과금된다** (품질 high 1024² ≈ 47쌤).
 *   기본은 설정만 채우고 멈춘다. 화면을 확인한 뒤 --generate 를 붙인다.
 *
 * 문서 2-2 의 교훈을 코드로 굳혔다:
 *   · 프리셋(#resourcePresetSelect)은 **건드리지 않는다** — 고르면 프롬프트를 덮어쓴다
 *   · 품질은 high (low 는 넓게 깔 타일이 0장 나왔다)
 *   · Classify 는 돌리지 않는다 (분류기가 러그를 장애물로, 돌바닥을 blocked 로 붙인 사례)
 *
 * 사용:
 *   node scripts/studio-ai-theme.mjs --name "우주선 실내 AI" --prompt bake/prompts/ship-floors.txt
 *   node scripts/studio-ai-theme.mjs ... --generate      # 실제 생성 (과금)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { withStudio, enterStudio, STUDIO_ORIGIN } from '../src/studio-browser.mjs';
import { createBackup } from '../src/studio-backup.mjs';

const args = process.argv.slice(2);
const arg = (n, d = null) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : d; };
const has = (n) => args.includes(n);

const themeName = arg('--name', '우주선 실내 AI');
const promptFile = arg('--prompt');
const quality = arg('--quality', 'high');
const model = arg('--model', 'gpt-image-2');
const grid = arg('--grid', '16x16');
const target = arg('--target', '32');
const openExisting = arg('--open');   // 이미 만든 오브젝트를 다시 열 때
const doGenerate = has('--generate');
const sourceImage = arg('--source');    // img2img 참조 이미지 (구조를 유지시킨다)
const headed = has('--headed');        // 창을 띄워 사람이 화면에서 직접 저장할 수 있게
const keepOpen = has('--keep-open');   // 작업 뒤 창을 닫지 않고 기다린다
const record = has('--record');        // 전 과정을 webm 으로 녹화
const doSlice = has('--slice');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

/**
 * 에디터 UI 는 **iframe 안**에 있다 (2026-08-20 실측).
 * page.waitForSelector 는 메인 프레임만 보므로 타임아웃 난다 — 프레임을 찾아 쓴다.
 */
async function frameWith(page, selector, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const f of page.frames()) {
      try { if (await f.$(selector)) return f; } catch { /* 떠난 프레임 */ }
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(`어느 프레임에서도 ${selector} 를 못 찾았습니다.`);
}

const SEL = {
  create: '[data-object-action="create"]',
  name: '#resourceThemeNameInput',
  concept: '#resourceConceptInput',
  prompt: '#resourcePromptInput',
  preset: '#resourcePresetSelect',      // ★ 건드리지 말 것
  model: '#resourceModelSelect',
  quality: '#resourceQualitySelect',
  generate: '#resourceGenerateButton',
  slice: '#sliceReferenceButton',
  classify: '#classifyTilesButton',     // ★ 쓰지 말 것
  source: '#themeSourceButton',
  sourceFile: '#sourceImageFileInput',
  sourceApply: '#applyThemeSourceButton',
  themeType: '#themeTypeSelect',
  tileSize: '#themeTileSizeSelect',
  gridSel: '#themeGridSelect',
  tags: '#themeTagsInput',
  cards: '.slice-resource-card',
};

await withStudio({ headless: !headed, ...(record ? { recordDir: 'out/videos' } : {}) }, async (ctx) => {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const api = [];
  // ★ route 로 응답을 프록시해서 본문을 확실히 붙잡는다.
  //   page.on('response') 는 본문을 놓친다 (2026-08-20: 캡처가 빈 배열로 나왔다).
  //   이 프로필은 브라우저를 닫으면 localStorage 가 통째로 사라지므로,
  //   그림은 **살아 있는 동안 네트워크에서** 건져야 한다.
  const captured = [];
  let rawImage = null;
  await page.route('**/api/ai-tiles/**', async (route) => {
   try {
    // 이미지 생성은 1분 이상 걸린다 — 기본 30초 타임아웃으로는 못 기다린다 (2026-08-20 실패).
    const resp = await route.fetch({ timeout: 300000 });
    const buf = await resp.body();
    const url = route.request().url();
    api.push({ status: resp.status(), url: url.replace(/^https?:\/\/[^/]+/, '') });
    if (url.includes('/generate') && resp.ok()) {
      try {
        const j = JSON.parse(buf.toString('utf8'));
        captured.push(j);
        const scanRaw = (v, d = 0) => {
          if (typeof v === 'string') {
            if (v.startsWith('data:image')) return Buffer.from(v.split(',')[1], 'base64');
            if (v.startsWith('iVBORw0KGgo') || v.startsWith('/9j/')) return Buffer.from(v, 'base64');
            return null;
          }
          if (v && typeof v === 'object' && d < 8) for (const x of Object.values(v)) { const h = scanRaw(x, d + 1); if (h) return h; }
          return null;
        };
        rawImage = scanRaw(j);
      } catch { /* JSON 이 아니면 넘어간다 */ }
    }
    await route.fulfill({ response: resp, body: buf });
   } catch (e) {
     console.warn('[route] 프록시 실패 — 원 요청을 그대로 흘려보냅니다:', e.message.split('\n')[0]);
     try { await route.continue(); } catch { /* 이미 처리됨 */ }
   }
  });

  const { session } = await enterStudio(page, { section: 'object' });
  console.log('세션 OK:', session.user?.email, session.renewed ? '(자동 갱신됨)' : '');

  // 백업 먼저 — 오브젝트가 추가되는 작업이다
  const ls = await page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
  await mkdir('out/backups', { recursive: true });
  await writeFile(path.join('out', 'backups', `studio-${stamp}.json`), JSON.stringify(createBackup(ls, 'object'), null, 2), 'utf8');
  console.log(`백업: out/backups/studio-${stamp}.json`);

  // 열 대상 정하기 — 목록 항목은 **이름 텍스트로** 눌러야 열린다 (data 셀렉터는 안 먹었다)
  const listNames = () => page.evaluate(() => JSON.parse(localStorage.getItem('sv_studio_smo_v1') || '[]').map((o) => o.name));
  let openName = openExisting;
  if (!openName) {
    const before = await listNames();
    console.log('새 오브젝트를 만듭니다…');
    // create 버튼도 프레임 안에 있을 수 있다 (편집 화면이 열린 채였다면 특히)
    const lf = await frameWith(page, SEL.create, 20000);
    await lf.click(SEL.create, { timeout: 10000 });
    await page.waitForTimeout(4000);
    const after = await listNames();
    openName = after.find((n) => !before.includes(n));
    if (!openName) throw new Error('새 오브젝트를 못 찾았습니다.');
    console.log(`만들어진 오브젝트: "${openName}"`);
  }
  console.log(`"${openName}" 을 엽니다…`);
  const nf = await frameWith(page, '.spum-resource-list__name', 20000);
  await nf.locator('.spum-resource-list__name', { hasText: openName }).first().click({ timeout: 10000 });
  await page.waitForTimeout(4000);
  const ed = await frameWith(page, SEL.name);
  console.log('에디터 프레임 확보');

  // 테마 설정 — 프리셋은 절대 건드리지 않는다
  await ed.fill(SEL.name, themeName);
  await ed.selectOption(SEL.themeType, 'map-theme').catch(() => {});
  await ed.selectOption(SEL.tileSize, target);
  await ed.selectOption(SEL.gridSel, grid);
  await ed.fill(SEL.tags, 'spaceship, sci-fi, floor, 16x16');
  await ed.selectOption(SEL.model, model);
  await ed.selectOption(SEL.quality, quality);

  // ── SOURCE 업로드 — img2img 로 구조를 유지시킨다 (문서 2-2) ──
  if (sourceImage) {
    try {
      // SOURCE 버튼은 파일 다이얼로그가 아니라 라이브러리 모달을 연다 (2026-08-20 실측).
      // 모달 안의 파일 input 에 직접 넣고 "Use Source" 로 적용한다.
      await ed.click(SEL.source, { timeout: 10000 });
      await page.waitForTimeout(2500);
      await ed.setInputFiles(SEL.sourceFile, sourceImage, { timeout: 15000 });
      await page.waitForTimeout(7000);   // 업로드·썸네일 생성
      await ed.click(SEL.sourceApply, { timeout: 10000 }).catch(() => console.warn('  (Use Source 버튼을 못 눌렀습니다 — 이미 적용됐을 수 있습니다)'));
      await page.waitForTimeout(4000);
      console.log(`SOURCE 적용: ${sourceImage}`);
    } catch (e) {
      console.warn('⚠ SOURCE 업로드 실패:', e.message.split('\n')[0]);
    }
  }

  if (promptFile) {
    const text = (await readFile(promptFile, 'utf8')).trim();
    await ed.fill(SEL.prompt, text);
    console.log(`프롬프트 ${text.length}자 입력 (${promptFile})`);
  }
  await page.waitForTimeout(1500);

  const state = await ed.evaluate((sel) => ({
    name: document.querySelector(sel.name)?.value,
    type: document.querySelector(sel.themeType)?.value,
    tileSize: document.querySelector(sel.tileSize)?.value,
    grid: document.querySelector(sel.gridSel)?.value,
    model: document.querySelector(sel.model)?.value,
    quality: document.querySelector(sel.quality)?.value,
    preset: document.querySelector(sel.preset)?.value,
    promptHead: (document.querySelector(sel.prompt)?.value || '').slice(0, 80),
  }), SEL);
  console.log('설정 상태:', JSON.stringify(state, null, 1));

  await page.screenshot({ path: `out/ai-theme-setup-${stamp}.png` });
  console.log(`스크린샷: out/ai-theme-setup-${stamp}.png`);

  if (!doGenerate) {
    // 설정만 하고 멈춘다. 저장은 Studio 가 알아서 로컬에 한다.
    await page.evaluate(async () => { await window.spumStudioData?.saveServerSnapshot?.('ai-theme-setup'); });
    console.log('\n--generate 를 붙이지 않아 생성은 하지 않았습니다 (과금 없음).');
    return;
  }

  console.log('\n▶ Generate — 실제로 과금됩니다…');
  await ed.click(SEL.generate, { timeout: 10000 });
  // 생성은 오래 걸린다. 응답이 올 때까지 최대 5분 기다린다.
  const deadline = Date.now() + 5 * 60 * 1000;
  let done = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(5000);
    if (api.some((r) => r.url.includes('/generate'))) { done = true; break; }
    process.stdout.write('.');
  }
  console.log('');
  console.log('AI API 응답:', JSON.stringify(api));

  const safeName = themeName.replace(/[^\w가-힣-]+/g, '_');
  await mkdir(path.join('out', 'assets-studio'), { recursive: true });

  // ① route 로 붙잡은 원본 — 가장 확실한 경로
  if (rawImage) {
    const out = path.join('out', 'assets-studio', `${safeName}__source-${stamp}.png`);
    await writeFile(out, rawImage);
    console.log(`★ 원본 확보(route ${Math.round(rawImage.length / 1024)}KB): ${out}`);
  }

  // ② SMO 레코드 통째로 덤프 — 어느 필드에 무엇이 있든 파일로는 남는다
  try {
    const dump = await page.evaluate((n) => {
      const smo = JSON.parse(localStorage.getItem('sv_studio_smo_v1') || '[]');
      return JSON.stringify(smo.find((o) => o.name === n) ?? null);
    }, themeName);
    if (dump && dump !== 'null') {
      await writeFile(path.join('out', 'assets-studio', `${safeName}__smo-${stamp}.json`), dump, 'utf8');
      console.log(`SMO 레코드 덤프: ${Math.round(dump.length / 1024)}KB`);
    }
  } catch (e) { console.warn('SMO 덤프 실패:', e.message); }

  // 가로챈 응답에서 이미지를 꺼낸다 (③ 보조 경로)
  await mkdir(path.join('out', 'assets-studio'), { recursive: true });
  // ★ 로그를 자르면 이미지가 잘린다 (2026-08-20: 200KB 절단으로 원본을 잃었다).
  //   큰 base64 는 자리표시자로 바꿔 로그만 가볍게 남기고, 실제 데이터는 아래에서 PNG 로 쓴다.
  await writeFile(path.join('out', 'assets-studio', `${safeName}__response-${stamp}.json`),
    JSON.stringify(captured, (k, v) => (typeof v === 'string' && v.length > 500 ? `<${v.length}자 생략>` : v), 1), 'utf8');
  for (const body of captured) {
    const scan = (v, depth = 0) => {
      if (typeof v === 'string') {
        if (v.startsWith('data:image')) return { kind: 'dataUrl', v };
        // 실제 응답은 image.data 에 **접두사 없는 base64** 였다. PNG/JPEG 시그니처로 잡는다.
        if (v.startsWith('iVBORw0KGgo') || v.startsWith('/9j/')) return { kind: 'rawB64', v };
        if (/^sha256:[0-9a-f]{64}$/.test(v)) return { kind: 'assetId', v };
        return null;
      }
      if (v && typeof v === 'object' && depth < 6) {
        for (const x of Object.values(v)) { const hit = scan(x, depth + 1); if (hit) return hit; }
      }
      return null;
    };
    const hit = scan(body);
    if (!hit) continue;
    const out = path.join('out', 'assets-studio', `${safeName}__source-${stamp}.png`);
    if (hit.kind === 'dataUrl') {
      await writeFile(out, Buffer.from(hit.v.split(',')[1], 'base64'));
      console.log(`★ 원본 확보(응답 dataURL): ${out}`);
    } else if (hit.kind === 'rawB64') {
      const buf = Buffer.from(hit.v, 'base64');
      await writeFile(out, buf);
      console.log(`★ 원본 확보(응답 base64 ${Math.round(buf.length / 1024)}KB): ${out}`);
    } else {
      const got = await page.evaluate(async (id) => {
        const r = await fetch(`/api/studio/assets/${encodeURIComponent(id)}`, { credentials: 'include' });
        if (!r.ok) return null;
        const b = new Uint8Array(await r.arrayBuffer());
        let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
        return btoa(bin);
      }, hit.v);
      if (got) { await writeFile(out, Buffer.from(got, 'base64')); console.log(`★ 원본 확보(assetId ${hit.v.slice(0, 20)}…): ${out}`); }
    }
    break;
  }

  // 백업 경로: SMO 레코드에서도 시도한다
  //   2026-08-20 사고: 생성은 됐는데 Studio 로컬이 날아가면서 assetId 를 잃었고,
  //   에셋 목록 API 가 없어(405/404) 이미지를 영영 못 찾았다. 125쌤이 그대로 날아갔다.
  //   그림은 비용이 든 산출물이다 — 만들자마자 손에 쥔다.
  try {
    const got = await page.evaluate(async (name) => {
      const smo = JSON.parse(localStorage.getItem('sv_studio_smo_v1') || '[]');
      const t = smo.find((o) => o.name === name)?.mapTheme;
      const id = t?.sliceBaseAssetId;
      if (!id) return { ok: false, why: 'sliceBaseAssetId 없음' };
      const r = await fetch(`/api/studio/assets/${encodeURIComponent(id)}`, { credentials: 'include' });
      if (!r.ok) return { ok: false, why: `HTTP ${r.status}` };
      const b = new Uint8Array(await r.arrayBuffer());
      let bin = '';
      for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
      return { ok: true, id, b64: btoa(bin) };
    }, themeName);
    if (got.ok) {
      const safe = themeName.replace(/[^\w가-힣-]+/g, '_');
      const out = path.join('out', 'assets-studio', `${safe}__source-${stamp}.png`);
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, Buffer.from(got.b64, 'base64'));
      console.log(`★ 원본 확보: ${out}`);
    } else {
      console.warn(`⚠ 원본을 못 받았습니다 (${got.why}) — 화면에서 직접 저장하세요.`);
    }
  } catch (e) {
    console.warn('⚠ 원본 저장 실패:', e.message);
  }
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `out/ai-theme-generated-${stamp}.png` });
  console.log(`스크린샷: out/ai-theme-generated-${stamp}.png`);
  if (!done) console.log('⚠ 5분 안에 generate 응답을 못 봤습니다 — 화면을 확인하세요.');

  if (doSlice) {
    console.log('Slice…');
    await ed.click(SEL.slice, { timeout: 10000 });
    await page.waitForTimeout(15000);
    const n = await ed.locator(SEL.cards).count();
    console.log(`슬라이스 결과: ${n}장 (40장 이하가 목표)`);
    await page.screenshot({ path: `out/ai-theme-sliced-${stamp}.png` });
  }

  // ★ 저장은 "불렀다" 가 아니라 "서버 리비전이 올라갔다" 로 확인한다.
  //   2026-08-20: 호출 직후 브라우저를 닫아 요청이 중단됐고, rev 가 안 올라간 채 데이터를 잃었다.
  const revBefore = await page.evaluate(async () => {
    const r = await fetch('/api/studio/revisions', { credentials: 'include' });
    const j = await r.json(); return j?.activeRevision ?? null;
  });
  const saved = await page.evaluate(async () => window.spumStudioData?.saveServerSnapshot?.('ai-theme'));
  await page.waitForTimeout(6000);
  const revAfter = await page.evaluate(async () => {
    const r = await fetch('/api/studio/revisions', { credentials: 'include' });
    const j = await r.json(); return j?.activeRevision ?? null;
  });
  console.log(`saveServerSnapshot → ${saved} · 리비전 ${revBefore} → ${revAfter}`);
  if (revAfter === revBefore) {
    console.warn('⚠ 서버 리비전이 안 올라갔습니다 — 이 작업은 서버에 저장되지 않았습니다.');
  }

  if (keepOpen) {
    console.log('');
    console.log('  ▶ 창을 열어 두었습니다. 화면에서 이미지를 직접 저장하실 수 있습니다.');
    console.log('    · 좌측 "1/10refs" 아래 썸네일 또는 가운데 Preview 캔버스에서 우클릭 → 이미지 저장');
    console.log('    · 저장 위치는 어디든 좋습니다. 끝나면 **창을 닫으세요** (닫아야 스크립트가 끝납니다).');
    console.log('');
    await new Promise((resolve) => {
      ctx.on('close', resolve);
      page.on('close', () => setTimeout(resolve, 500));
    });
    console.log('창이 닫혔습니다.');
  }
});