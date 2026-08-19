#!/usr/bin/env node
/**
 * SPUM Object 에디터의 AI 타일 생성에 넣을 **소스 이미지**를 만든다.
 *
 * 왜 소스를 직접 만드나 — 두 가지 이유가 실측으로 확인됐다:
 *
 * 1. 생성은 img2img 다. `theme.source.imageDataUrl` 이 있으면
 *    `body.referenceImage` 로 이미지 모델에 함께 넘어가고, 결과가 소스의 **구조를
 *    유지**한다. 프롬프트만으로는 매번 배치가 달라진다.
 *
 * 2. 슬라이스가 **픽셀이 완전히 같은 조각만** 합친다 (`_tileSignature`).
 *    그래서 칸마다 미세하게 다른 그림은 256칸이 160장 넘는 고유 타일로 쪼개지고,
 *    분류는 128장에서 잘린다. 소스를 "칸마다 똑같은 평면"으로 주면 그 확률이 올라간다.
 *
 * 팀 가이드 §4-9-b 의 성공 조건도 같은 방향이다 —
 * `seamless` 같은 추상어는 안 먹히고, **"평평한 단색 면"** 을 요구하면 된다.
 *
 * 사용: node scripts/make-ai-source.mjs --spec bake/ai-source-med.json
 * 결과: out/ai-sources/<key>.png (1024×1024) + 붙여넣을 프롬프트 출력
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { Canvas } from '../src/png.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const specPath = arg('spec');
if (!specPath) {
  console.error('사용법: node scripts/make-ai-source.mjs --spec bake/ai-source-med.json');
  process.exit(1);
}
const spec = JSON.parse(await readFile(resolve(specPath), 'utf8'));

const grid = Math.max(1, Number(spec.grid) || 16);       // 16x16 격자
const size = Math.max(64, Number(spec.size) || 1024);    // 1024x1024
const cell = Math.floor(size / grid);
const canvas = new Canvas(cell * grid, cell * grid);

function hex(value) {
  const m = String(value || '').trim().replace('#', '');
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16), 255];
}

const regions = Array.isArray(spec.regions) ? spec.regions : [];
if (regions.length === 0) {
  console.error('regions 가 필요합니다.');
  process.exit(1);
}

// 배경을 첫 영역 색으로 채운 뒤 영역을 덮는다 (빈 칸이 남지 않게)
canvas.fill(0, 0, canvas.width, canvas.height, hex(regions[0].color));
for (const region of regions) {
  const [c0, r0, w, h] = region.rect;
  canvas.fill(c0 * cell, r0 * cell, w * cell, h * cell, hex(region.color));
}

const png = canvas.toPng();
const pngPath = resolve(`out/ai-sources/${spec.key}.png`);
await mkdir(dirname(pngPath), { recursive: true });
await writeFile(pngPath, png);

// 프롬프트 — 영역을 위치·색으로 지목하고, 평면 유지를 못박는다
const FLAT = [
  'Every tile is a PLAIN FLAT COLOR FIELD filling the whole square edge to edge.',
  'No borders, no frames, no objects, no furniture, no shadows, no gradients, no vignetting.',
  'Only a very subtle material grain, almost uniform.',
  'Keep the four quadrants as separate uniform fields with a hard edge between them.',
  'Do not draw a scene. This is a material swatch chart.',
];
const lines = regions.map((region) => {
  const [c0, r0, w, h] = region.rect;
  const where = `cells (${c0},${r0}) to (${c0 + w - 1},${r0 + h - 1})`;
  return `${where} = ${region.prompt} (base color ${region.color})`;
});
const prompt = [
  spec.style || 'top-down 2d pixel-art material swatches for a mediterranean stone villa',
  ...lines,
  ...FLAT,
].join(', ').replace(/,\s*,/g, ', ');

const promptPath = resolve(`out/ai-sources/${spec.key}-prompt.txt`);
await writeFile(promptPath, `${prompt}\n`, 'utf8');

console.log(`[make-ai-source] ${canvas.width}×${canvas.height} · 격자 ${grid}×${grid} · 칸 ${cell}px · ${(png.length / 1024).toFixed(1)}KB`);
for (const region of regions) {
  const [c0, r0, w, h] = region.rect;
  console.log(`  ${region.color}  ${String(w * h).padStart(3)}칸  (${c0},${r0})~(${c0 + w - 1},${r0 + h - 1})  ${region.name}`);
}
console.log('');
console.log(`[make-ai-source] → ${pngPath}`);
console.log(`[make-ai-source] → ${promptPath}`);
console.log('');
console.log('─── Reference Prompt 에 붙여넣을 내용 ───');
console.log(prompt);
