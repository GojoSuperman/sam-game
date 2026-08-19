#!/usr/bin/env node
/**
 * 레이아웃 설정 → SPUM Studio 맵 생성 CLI.
 *
 * SPUM 에는 맵을 만드는 서버 REST API 가 없다 (실측: /api/studio/* 에 리소스
 * CRUD 가 없고, 인증은 httpOnly 쿠키 세션뿐이라 API 키로 못 들어간다).
 * 대신 맵은 localStorage 키 `sv_studio_maps_v1` 에 들어가고, Studio 는
 * 그 키 뭉치를 통째로 내보내기/불러오기 할 수 있다. 이 스크립트는 그
 * "불러오기용 백업 파일" 을 만든다.
 *
 * 사용:
 *   node scripts/make-map.mjs --config bake/example-map.json --preview
 *   node scripts/make-map.mjs --config bake/my-map.json --into ~/Downloads/spum-studio-backup-20260819.json
 *
 * 결과: out/<slug>-studio-map.json
 *   → Studio 우상단 메뉴 → 데이터 불러오기 → 이 파일 → 새로고침 → 서버 저장
 *
 * ★ --into 를 쓰는 것이 기본이다. 불러오기는 병합이 아니라 **전체 교체**라,
 *   맵만 든 파일을 그냥 불러오면 캐릭터·오브젝트·월드가 사라진다.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { buildMapFromLayout, renderAscii } from '../src/map-builder.mjs';
import { validateMapRecord, reachableFrom, idx, MAPS_KEY, NAV_ON } from '../src/spum-map.mjs';
import { createBackup, readBackup, readKeyArray, mergeIntoBackup, summarizeBackup } from '../src/studio-backup.mjs';
import { renderPreviewHtml } from '../src/map-preview.mjs';
import { normalizeTheme, mergeThemes, tileBlocks, describeTheme } from '../src/spum-theme.mjs';
import { buildMapSnippet } from '../src/studio-snippet.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}

const configPath = arg('config');
if (!configPath) {
  console.error(`사용법: node scripts/make-map.mjs --config <레이아웃.json> [--into <Studio백업.json>] [--preview]

옵션:
  --config <경로>   레이아웃 설정 (필수). 예시: bake/example-map.json
  --into <경로>     Studio 에서 내보낸 백업 파일. 그 위에 맵만 얹는다 (권장)
  --out <경로>      결과 경로 (기본 out/<slug>-studio-map.json)
  --preview         ASCII 미리보기를 터미널에 출력
  --html            실제 타일로 그린 미리보기 HTML 도 만든다 (out/<slug>-preview.html)
  --scale <배율>    미리보기 배율 (0.5 = 절반 크기. 큰 맵을 한 화면에 담을 때)
  --snippet         맵만 넣는 콘솔 스니펫을 만든다 (권장 — 전체 교체가 아니다)
  --standalone      --into 없이 단독 백업 파일을 쓴다 (★ 불러오면 다른 데이터가 전부 사라진다)
  --replace         --into 안에 같은 이름의 맵이 있으면 덮어쓴다 (기본: 덮어씀)
  --append          같은 이름이 있어도 새 맵으로 추가한다
  --theme <경로>    맵 테마 파일. **여러 번 쓸 수 있다** — 테마마다 id 대역을
                    2048 간격으로 받는다 (2049 · 4097 · 6145 …).
                    별칭이 겹치면 앞선 테마가 이기고, "키.별칭" 으로 정확히 고른다
                    (예: outdoor.grass · indoor.wood_floor). 키 = 파일 이름
  --palette         테마의 타일 목록만 출력하고 끝낸다
  --tile-check      타일 id 를 쓰기 전에 내장 타일셋 범위만 확인하고 끝낸다

레이아웃 설정 형식은 bake/example-map.json 을 보세요.`);
  process.exit(1);
}

// ── 0. 테마 (여러 개 가능) ─────────────────────────────────
function allArgs(name) {
  const out = [];
  process.argv.forEach((token, i) => {
    if (token !== `--${name}`) return;
    const value = process.argv[i + 1];
    if (value && !value.startsWith('--')) out.push(value);
  });
  return out;
}

const themePaths = allArgs('theme');
const requested = themePaths.length > 0 ? themePaths : ['out/themes/spum-default.json'];
let theme = null;
const loaded = [];
for (const path of requested) {
  try {
    const raw = JSON.parse(await readFile(resolve(path), 'utf8'));
    const key = String(raw.key || path.replace(/^.*[/\\]/, '').replace(/\.json$/, ''))
      .replace(/[^\w가-힣-]+/g, '-');
    loaded.push({ key, theme: normalizeTheme(raw.asset || raw, { aliases: raw.aliases || {} }) });
  } catch (error) {
    if (themePaths.length > 0) {
      console.error(`[make-map] 테마를 읽지 못했습니다: ${path}\n  ${error.message}`);
      process.exit(1);
    }
  }
}
if (loaded.length > 0) {
  theme = mergeThemes(loaded);
  for (const entry of theme.themes) {
    console.log(`[make-map] 테마 "${entry.name}" [${entry.key}] · 타일 ${entry.tiles.length}장 · id ${entry.tileIdBase}~${entry.tileIdBase + entry.tiles.length - 1}`);
  }
} else {
  console.log('[make-map] 테마 없음 — 내장 타일셋(1~256) 기준으로 갑니다. `pnpm fetch-theme` 로 기본 테마를 받을 수 있습니다.');
}

if (flag('palette')) {
  if (!theme) {
    console.error('[make-map] --palette 는 테마가 있어야 합니다.');
    process.exit(1);
  }
  for (const entry of theme.themes) {
    console.log(`\n[${entry.key}] ${entry.name} — id ${entry.tileIdBase}~`);
    console.log('  id    별칭         이름         분류               이동');
    console.log(describeTheme(entry));
  }
  process.exit(0);
}

const config = JSON.parse(await readFile(resolve(configPath), 'utf8'));
const slug = String(config.slug || config.name || 'map')
  .trim().toLowerCase().replace(/[^a-z0-9가-힣-]+/g, '-').replace(/^-+|-+$/g, '') || 'map';

// ── 1. 생성 ────────────────────────────────────────────────
const { record, notes } = buildMapFromLayout(config, { theme });
console.log(`[make-map] "${record.name}" ${record.width}×${record.height} · 타일 ${record.tileSize}px · id ${record.id}`);

for (const note of notes) console.log(`  · ${note}`);

// ── 2. 검증 ────────────────────────────────────────────────
const { errors, warnings } = validateMapRecord(record);

// 테마의 이동 특성과 내가 만든 walkable 이 어긋나는지 — Studio 에서 다시 칠할 때
// applyTilePropertiesToNavigation 이 테마 쪽을 따르므로 나중에 뒤집힐 수 있다.
if (theme) {
  const walkableLayer = record.layers.find((l) => l.name === 'walkable');
  const floorLayer = record.layers.find((l) => l.name === 'back_1');
  const conflicts = new Map();
  for (let i = 0; i < floorLayer.data.length; i += 1) {
    const tile = floorLayer.data[i];
    if (!tile || walkableLayer.data[i] !== NAV_ON) continue;
    if (tileBlocks(theme, tile)) conflicts.set(tile, (conflicts.get(tile) || 0) + 1);
  }
  for (const [tile, count] of conflicts) {
    const name = theme.tileProperties[String(tile)]?.name || tile;
    warnings.push(`바닥으로 쓴 타일 ${tile}("${name}")은 테마에서 movement:blocked 입니다 (${count}칸). Studio 에서 덧칠하면 obstacle 로 뒤집힐 수 있습니다.`);
  }
}

// 연결성 — 문 없는 방을 잡는다. Studio 는 이걸 안 잡아주고, 플레이해야 알게 된다.
const unreachable = [];
if (record.spawnPoints.length > 0) {
  const first = record.spawnPoints[0];
  const seen = reachableFrom(record, first.x, first.y);
  const walkable = record.layers.find((l) => l.name === 'walkable');
  const total = walkable.data.filter((v) => v === NAV_ON).length;
  const reached = Array.from(seen).filter(Boolean).length;
  for (const point of record.spawnPoints.slice(1)) {
    if (!seen[idx(record.width, point.x, point.y)]) unreachable.push(point.label || `(${point.x},${point.y})`);
  }
  console.log(`  · walkable ${total}칸 · 첫 스폰 "${first.label || ''}" 에서 도달 ${reached}칸 (${Math.round((reached / total) * 100)}%)`);
  // 스폰이 안 놓인 곳이라도 갇힌 칸은 잡는다 — 가구가 방을 가로로 막는 사고가 실제로 났다.
  if (reached < total) {
    const stranded = [];
    for (let row = 0; row < record.height && stranded.length < 6; row += 1) {
      for (let col = 0; col < record.width && stranded.length < 6; col += 1) {
        const at = idx(record.width, col, row);
        if (walkable.data[at] === NAV_ON && !seen[at]) stranded.push(`(${col},${row})`);
      }
    }
    warnings.push(`갇힌 walkable 칸 ${total - reached}개 — 예: ${stranded.join(' ')}. 가구가 통로를 막았는지 보세요.`);
  }

  // 맨바닥 비율 — "휑하다"를 눈이 아니라 숫자로 본다.
  // 분모는 "바닥이 깔린 칸에서 벽을 뺀 것" 이다. 가구가 놓인 칸은 통행 불가가 되므로
  // walkable 만 세면 가구를 늘려도 비율이 안 움직인다 (처음에 그렇게 재서 틀렸다).
  const front = record.layers.find((l) => l.name === 'front_1');
  const backFloor = record.layers.find((l) => l.name === 'back_1');
  const wallLayer = record.layers.find((l) => l.name === 'back_2');
  let floorCells = 0;
  let occupied = 0;
  for (let i = 0; i < walkable.data.length; i += 1) {
    const isWall = wallLayer ? wallLayer.data[i] !== 0 : false;
    const hasFloor = backFloor ? backFloor.data[i] !== 0 : false;
    if (isWall || !hasFloor) continue;
    floorCells += 1;
    if (front && front.data[i] !== 0) occupied += 1;
  }
  if (floorCells > 0) {
    console.log(`  · 맨바닥 ${Math.round(((floorCells - occupied) / floorCells) * 100)}% (바닥 ${floorCells}칸 중 ${occupied}칸에 무엇이 놓임)`);
  }
}
if (unreachable.length > 0) {
  errors.push(`첫 스폰에서 못 가는 구역: ${unreachable.join(', ')} — 문(doors)이나 복도(corridors)가 빠졌습니다.`);
}

for (const warning of warnings) console.log(`  ⚠ ${warning}`);
for (const error of errors) console.error(`  ✖ ${error}`);

if (flag('preview')) {
  console.log('');
  console.log(renderAscii(record));
  console.log('');
}

if (errors.length > 0) {
  console.error(`[make-map] 오류 ${errors.length}건 — 파일을 쓰지 않았습니다.`);
  process.exit(1);
}

if (flag('snippet')) {
  const snippetPath = resolve(`out/${slug}-snippet.js`);
  await mkdir(dirname(snippetPath), { recursive: true });
  await writeFile(snippetPath, buildMapSnippet(record), 'utf8');
  console.log(`[make-map] 콘솔 스니펫 → ${snippetPath}`);
  console.log('  Studio 탭에서 F12 → Console 에 붙여넣으면 이 맵만 들어갑니다.');
}

if (flag('html')) {
  const htmlPath = resolve(`out/${slug}-preview.html`);
  await mkdir(dirname(htmlPath), { recursive: true });
  const scale = Number(arg('scale', '1')) || 1;
  await writeFile(htmlPath, renderPreviewHtml(record, { theme, scale }), 'utf8');
  console.log(`[make-map] 미리보기 → ${htmlPath}`);
}

if (flag('tile-check')) {
  console.log('[make-map] --tile-check: 검증만 하고 끝냅니다.');
  process.exit(0);
}

// ── 3. 백업 파일로 포장 ────────────────────────────────────
const intoPath = arg('into');
let backup;
if (intoPath) {
  const base = await readBackup(resolve(intoPath));
  console.log(`[make-map] 기존 백업에 얹습니다: ${intoPath}`);
  console.log(`  · 현재 내용 — ${summarizeBackup(base)}`);
  const maps = readKeyArray(base, MAPS_KEY);
  const sameName = maps.findIndex((m) => String(m?.name || '') === record.name);
  if (sameName > -1 && !flag('append')) {
    record.id = String(maps[sameName].id || record.id); // id 유지 = 월드의 맵 참조가 안 끊긴다
    record.meta.createdAt = maps[sameName].meta?.createdAt || record.meta.createdAt;
    maps[sameName] = record;
    console.log(`  · 같은 이름의 맵을 덮어씁니다 (id ${record.id} 유지)`);
  } else {
    maps.unshift(record);
    console.log(`  · 새 맵으로 추가합니다 (총 ${maps.length}개)`);
  }
  backup = mergeIntoBackup(base, MAPS_KEY, maps, 'map');
} else if (flag('standalone')) {
  console.log('[make-map] ⚠ --standalone: 단독 백업 파일을 씁니다.');
  console.log('           이 파일을 불러오면 Studio 의 캐릭터·오브젝트·월드가 전부 사라집니다.');
  backup = createBackup({ [MAPS_KEY]: [record] }, 'map');
} else {
  // 2026-08-19: --into 없이 만든 파일을 불러와 캐릭터 5명과 테마 작업이 날아갔다.
  // 불러오기는 병합이 아니라 전체 교체라, 그런 파일은 만들어두기만 해도 지뢰가 된다.
  console.error('');
  console.error('[make-map] 백업 파일을 쓰지 않았습니다 — 불러오기는 **전체 교체**이기 때문입니다.');
  console.error('           맵 하나 넣자고 캐릭터·오브젝트·월드를 갈아끼우게 됩니다.');
  console.error('');
  console.error('  권장:  --snippet     맵만 넣는 콘솔 스니펫 (다른 데이터 안 건드림)');
  console.error('  또는:  --into <백업>  Studio 에서 내보낸 백업 위에 맵만 얹기');
  console.error('  굳이:  --standalone  단독 파일 (위험을 알고 쓸 때)');
  console.error('');
  process.exit(1);
}

const outPath = resolve(arg('out', `out/${slug}-studio-map.json`));
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(backup, null, 2), 'utf8');
console.log(`[make-map] 완료 → ${outPath}`);
console.log('');
console.log('넣는 법:');
console.log('  1. https://spum.soonsoon.ai/studio/ 로그인');
console.log('  2. 우상단 메뉴 → 데이터 불러오기 → 이 파일 선택 → 확인 (새로고침됨)');
console.log('  3. 맵 섹션에서 확인 → 서버 저장(자동 저장이 돌지만 수동으로도 가능)');
