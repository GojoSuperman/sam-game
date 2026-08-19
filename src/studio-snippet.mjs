/**
 * 맵 하나만 localStorage 에 밀어넣는 콘솔 스니펫을 만든다.
 *
 * 왜 파일 불러오기 대신 이걸 쓰나:
 *   Studio 의 "로컬 데이터 로드하기" 는 **전체 교체**다(`replaceStudioData`).
 *   맵 하나 넣자고 캐릭터·오브젝트·월드를 통째로 갈아끼우는 셈이라,
 *   백업을 빠뜨리면 그대로 날아간다 (2026-08-19 실제로 발생).
 *   이 스니펫은 `sv_studio_maps_v1` 키 하나만 건드린다.
 *
 * 방향 규칙(팀 가이드 §4-2-a, 실측):
 *   ❌ 서버에 직접 PUT → 다음 새로고침 때 브라우저 로컬이 서버를 덮어쓴다
 *   ✅ localStorage 에 쓰고 → saveServerSnapshot() → 새로고침
 */

export function buildMapSnippet(record) {
  const json = JSON.stringify(record);
  return `// SPUM Studio 콘솔에 붙여넣으세요 (F12 → Console)
// 맵 "${record.name}" 하나만 추가/교체합니다. 다른 데이터는 건드리지 않습니다.
(async () => {
  const KEY = 'sv_studio_maps_v1';
  const map = ${json};

  const before = JSON.parse(localStorage.getItem(KEY) || '[]');
  console.log('[before] 맵', before.length, '개:', before.map((m) => m.name).join(', '));

  // 같은 이름이 있으면 id 를 유지한 채 교체한다 — 월드의 맵 참조가 안 끊긴다
  const at = before.findIndex((m) => m.name === map.name);
  if (at > -1) {
    map.id = before[at].id;
    map.meta = { ...map.meta, createdAt: before[at].meta?.createdAt || map.meta.createdAt };
    before[at] = map;
    console.log('[patch] 같은 이름을 교체 (id', map.id, '유지)');
  } else {
    before.unshift(map);
    console.log('[patch] 새 맵으로 추가');
  }

  localStorage.setItem(KEY, JSON.stringify(before));
  // 앱에 알린다 (localStorage 직접 쓰기는 앱이 모른다)
  window.dispatchEvent(new CustomEvent('spum:studio-storage-write', { detail: { key: KEY, action: 'set' } }));

  // 로컬 → 서버 순서. 반대로 하면 날아간다
  if (window.spumStudioData?.saveServerSnapshot) {
    const ok = await window.spumStudioData.saveServerSnapshot('map-import');
    console.log('[server] saveServerSnapshot →', ok);
  } else {
    console.warn('[server] window.spumStudioData 가 없습니다. Studio 탭인지 확인하세요.');
  }

  console.log('[after] 맵', JSON.parse(localStorage.getItem(KEY)).length, '개. 새로고침하면 화면에 반영됩니다.');
  console.log('※ Map Editor 에서 타일이 안 보이면 MAP STRUCTURE > Layers 의 NAV 체크박스(Block/Walk)를 끄세요.');
})();
`;
}
