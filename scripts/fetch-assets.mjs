#!/usr/bin/env node
/**
 * CC0 타일 에셋 팩을 받아 out/assets/ 에 풀어둔다.
 *
 * Kenney Roguelike RPG Pack — Creative Commons Zero (CC0, 퍼블릭 도메인).
 * 출처 표기 의무도 없고 상업 이용도 자유다. 이 리포에 바이너리를 커밋하지 않고
 * 필요할 때 받는다 (out/ 은 .gitignore 대상).
 *
 * 사용: node scripts/fetch-assets.mjs
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const PACKS = [
  {
    key: 'kenney-roguelike-rpg',
    name: 'Kenney Roguelike RPG Pack (CC0)',
    url: 'https://kenney.nl/media/pages/assets/roguelike-rpg-pack/12c03cd78b-1677697420/kenney_roguelike-rpg-pack.zip',
    // 시트 규격 — 팩의 spritesheetInfo.txt 에 적힌 값
    sheet: 'Spritesheet/roguelikeSheet_transparent.png',
    tileSize: 16,
    margin: 1,
  },
];

for (const pack of PACKS) {
  const dir = resolve(`out/assets/${pack.key}`);
  await mkdir(dir, { recursive: true });
  const zipPath = `${dir}.zip`;

  console.log(`[fetch-assets] ${pack.name}`);
  const response = await fetch(pack.url);
  if (!response.ok) {
    console.error(`  실패 HTTP ${response.status}`);
    process.exit(1);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(zipPath, bytes);
  console.log(`  받음 ${(bytes.length / 1024).toFixed(0)}KB`);

  await run('unzip', ['-o', '-q', zipPath, '-d', dir]);
  console.log(`  풀었음 → ${dir}`);
  console.log(`  시트 ${pack.sheet} · 타일 ${pack.tileSize}px · 여백 ${pack.margin}px`);
  console.log('  라이선스: CC0 (out/assets/<pack>/License.txt 참고)');
}
