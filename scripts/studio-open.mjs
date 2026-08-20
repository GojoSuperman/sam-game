/**
 * 자동화 프로필로 Studio 창을 띄우고, 사람이 닫을 때까지 유지한다.
 *
 * 왜 이 창으로 봐야 하나 (문서 1-2):
 *   localStorage 가 원본이고 서버는 백업이다. 평소 쓰던 크롬에 예전 데이터가 남아
 *   있으면, 그 브라우저로 Studio 를 열었을 때 **로컬이 서버를 덮어쓴다.**
 *   코드로 넣은 맵이 그렇게 날아갈 수 있다. 그래서 확인은 이 프로필에서 한다.
 *
 * 사용: npm run studio-open [-- --section map]
 */

import { withStudio, enterStudio, STUDIO_ORIGIN } from '../src/studio-browser.mjs';

const args = process.argv.slice(2);
const section = (() => { const i = args.indexOf('--section'); return i > -1 ? args[i + 1] : 'map'; })();

await withStudio({ headless: false }, async (ctx) => {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const { session } = await enterStudio(page, { section });
  console.log(`로그인 상태: ${session.user?.email}`);

  const maps = await page.evaluate(() => JSON.parse(localStorage.getItem('sv_studio_maps_v1') || '[]').map((m) => `${m.name} (${m.width}×${m.height})`));
  console.log('맵 목록:', maps.join(' · ') || '(없음)');
  console.log('');
  console.log('  창을 띄웠습니다. 다 보시면 **창을 닫으세요** — 창을 닫아야 세션이 안전하게 저장됩니다.');
  console.log('  타일이 오버레이(빨강/초록)에 가려지면 오른쪽 MAP STRUCTURE > Navigation 의');
  console.log('  체크박스 2개(장애물/워커블)를 끄세요.');

  // 창이 닫힐 때까지 기다린다
  await new Promise((resolve) => {
    ctx.on('close', resolve);
    page.on('close', () => setTimeout(resolve, 500));
  });
  console.log('창이 닫혔습니다.');
});
