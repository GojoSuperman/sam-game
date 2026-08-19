#!/usr/bin/env node
/**
 * 맵 생성용 **AI 이미지 프롬프트**를 만든다.
 *
 * 왜 이 방식인가 (실측 근거):
 *   실제 건축 도면(지중해 저택)을 자동 판독해 보니 실패했다 — 세피아 단색조라
 *   초록 픽셀이 0.1%(96/66,010)뿐이고, 벽·바닥·포장이 모두 같은 색조(h30)에
 *   명도만 달라서 가구와 벽이 구분되지 않았다.
 *
 *   그림을 "예쁘게" 받는 대신 **읽을 수 있는 규격으로** 받으면 이 문제가 사라진다.
 *   순수 채도 색으로 칠해달라고 하면 색 사이 거리가 멀어 JPEG 잡음에도 견디고,
 *   자체 검증에서 저신뢰 0칸으로 정확히 되돌려 읽혔다.
 *
 *   AI 는 "배치를 상상하는 일"을 하고, 정확한 변환·검증은 코드가 한다.
 *
 * 사용: node scripts/make-map-prompt.mjs --subject "중세 왕국의 성 내부" [--grid 48x34]
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MASK_LEGEND } from '../src/blueprint.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

const subject = arg('subject');
if (!subject) {
  console.error('사용법: node scripts/make-map-prompt.mjs --subject "중세 왕국의 성 내부" [--grid 48x34] [--key castle]');
  process.exit(1);
}
const grid = arg('grid', '48x34');
const [cols, rows] = grid.split('x').map(Number);
const key = (arg('key') || subject).replace(/\s+/g, '-').replace(/[^\w가-힣-]/g, '').slice(0, 40);

const legendLines = MASK_LEGEND.map((l) => `${l.hex} = ${l.role.toUpperCase()} (${l.ko})`);
const prompt = [
  'top-down orthographic floor plan diagram, FLAT SOLID COLORS ONLY, color-coded by function.',
  '',
  'Color legend — use these exact colors and nothing else:',
  ...MASK_LEGEND.map((l) => `  ${l.hex} = ${l.role}`),
  '',
  `Subject: ${subject}`,
  '',
  'Hard rules:',
  '  - no shading, no gradients, no textures, no outlines, no highlights',
  '  - NO TEXT anywhere: no labels, no room names, no dimensions, no legend box, no title',
  '  - no perspective, no 3D, strictly flat top-down',
  '  - only the listed colors, fully saturated, sharp hard edges between regions',
  `  - align regions to a ${cols} x ${rows} grid; every cell is one solid color`,
  '  - walls continuous and closed so rooms are properly enclosed, at least 2 cells thick',
  '  - each element is ONE solid block of its color — never outline anything',
  '  - rugs and carpets are WALKABLE: paint them white (floor), never magenta',
  '  - door openings are white (walkable); only the door LEAF itself is yellow',
  '  - this is a FIRST floor plan: no stairs at all',
].join('\n');

const savePath = `out/masks/${key}.png`;
const mapPath = `bake/blueprint-${key}.json`;

await mkdir(resolve('out/masks'), { recursive: true });
await writeFile(resolve(`out/masks/${key}-prompt.txt`), `${prompt}\n`, 'utf8');

// 역할→타일 배정 기본값 (테마에 맞춰 고치면 된다)
const mapping = {
  floor: ['stone_floor', 'stone_floor:1', 'stone_floor:2'],
  wall: ['wall_20_13', 'wall_21_13'],
  door: ['pave', 'pave:1'],
  plant: ['cypress', 'plant', 'tree'],
  water: ['water', 'water:1'],
  outside: ['grass', 'grass:1', 'grass:2'],
  prop: ['table_c', 'chair', 'dresser'],
};
await writeFile(resolve(mapPath), `${JSON.stringify(mapping, null, 2)}\n`, 'utf8');

console.log(`[map-prompt] 주제: ${subject}`);
console.log(`[map-prompt] 격자: ${cols}×${rows}`);
console.log('');
console.log('─── 이미지 생성 프롬프트 (그대로 붙여넣기) ───');
console.log(prompt);
console.log('');
console.log('─── 색 범례 ───');
for (const line of legendLines) console.log(`  ${line}`);
console.log('');
console.log('─── 다음 순서 ───');
console.log(`  1. 위 프롬프트로 이미지를 생성합니다 (아무 도구나 — 정사각형/가로 비율 권장)`);
console.log(`  2. 저장 위치:  ${savePath}`);
console.log(`     윈도우에서 받으셨으면 파일 경로만 알려주셔도 제가 옮깁니다`);
console.log(`  3. 맵 생성:`);
console.log(`     pnpm exec node scripts/map-from-blueprint.mjs \\`);
console.log(`       --image ${savePath} --color-mask --grid ${grid} \\`);
console.log(`       --theme out/themes/med.json --map ${mapPath} \\`);
console.log(`       --name "${subject}" --snippet --html --ascii`);
console.log('');
console.log(`  역할→타일 배정: ${mapPath}  (테마에 맞춰 고치면 됩니다)`);
console.log('  판독이 어긋난 칸은 out/<key>-mask.html 에서 칠해 고치고 --roles 로 다시 돌립니다.');
