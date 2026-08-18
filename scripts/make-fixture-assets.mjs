#!/usr/bin/env node
/**
 * SPUM export 를 흉내낸 합성 자산 생성기.
 *
 *   node scripts/make-fixture-assets.mjs
 *
 * 왜 필요한가: 진짜 SPUM export 가 손에 들어오기 전에 로더·렌더러를 검증해야 한다.
 * SPUM 의 sheet.json 스키마와 그리드 규칙을 그대로 따르는 PNG + JSON 쌍을 만든다.
 * 진짜 export 를 같은 폴더에 덮어쓰면 그대로 동작한다.
 *
 * PNG 는 의존성 없이 직접 인코딩한다 (zlib 은 Node 내장).
 */
import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

// ── 최소 PNG 인코더 (RGBA, 8bit) ────────────────────────────────────
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── 프레임 그림: 사람 형태의 픽셀 실루엣 + 프레임마다 미세한 흔들림 ──
function drawFrames({ frameSize, totalFrames, columns, rows, color, accent, emote, gait, sit }) {
  const W = columns * frameSize;
  const H = rows * frameSize;
  const buf = Buffer.alloc(W * H * 4, 0); // 투명
  const put = (x, y, [r, g, b, a = 255]) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = a;
  };
  const rect = (x0, y0, w, h, c) => {
    for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) put(x, y, c);
  };

  for (let f = 0; f < totalFrames; f += 1) {
    const ox = (f % columns) * frameSize;
    const oy = Math.floor(f / columns) * frameSize;
    const u = frameSize / 32;                      // 32단위 그리드로 그린다
    const bob = Math.round(Math.sin((f / totalFrames) * Math.PI * 2) * u); // 상하 흔들림
    const S = (n) => Math.round(n * u);

    // 프레임 경계 표식 — 그리드가 밀리면 눈에 바로 보이게
    rect(ox, oy, frameSize, S(1) || 1, [255, 255, 255, 28]);
    rect(ox, oy, S(1) || 1, frameSize, [255, 255, 255, 28]);

    const cx = ox + S(16);
    // 걷기는 상하 흔들림을 크게, 앉기는 몸을 낮춘다
    const phase = (f / totalFrames) * Math.PI * 2;
    const top = oy + S(sit ? 12 : 6) + (gait ? Math.round(Math.sin(phase * 2) * u) : bob);
    rect(cx - S(4), top, S(8), S(8), accent);           // 머리
    rect(cx - S(5), top + S(8), S(10), S(sit ? 8 : 11), color); // 몸통

    if (sit) {
      // 앉은 자세 — 다리를 앞으로 접는다
      rect(cx - S(6), top + S(16), S(12), S(3), color);
      rect(cx - S(7), top + S(9), S(2), S(7), color);
      rect(cx + S(5), top + S(9), S(2), S(7), color);
    } else if (gait) {
      // 걷기 — 팔다리가 반대로 스윙한다
      const sw = Math.round(Math.sin(phase) * S(3));
      rect(cx - S(7) - sw, top + S(9), S(2), S(8), color);   // 왼팔
      rect(cx + S(5) + sw, top + S(9), S(2), S(8), color);   // 오른팔
      rect(cx - S(4) + sw, top + S(19), S(3), S(7), color);  // 왼다리
      rect(cx + S(1) - sw, top + S(19), S(3), S(7), color);  // 오른다리
    } else {
      rect(cx - S(7), top + S(9), S(2), S(8), color);
      rect(cx + S(5), top + S(9), S(2), S(8), color);
      rect(cx - S(4), top + S(19), S(3), S(7), color);
      rect(cx + S(1), top + S(19), S(3), S(7), color);
    }

    // 이모트 표식 — 어떤 시트인지 그림만 봐도 구분되게
    if (emote) {
      const m = { happy: [255, 214, 102], greet: [126, 214, 255], surprised: [255, 138, 128],
                  thinking: [186, 168, 255], proud: [255, 176, 233] }[emote] || [255, 255, 255];
      rect(cx + S(6), top - S(4), S(4), S(4), m);
    }
  }
  return { buf, W, H };
}

const OUT = resolve('web/game/assets/characters');
await mkdir(OUT, { recursive: true });

/** 서고 사건의 다섯 용의자. persona 는 SPUM Studio 에서 채울 값의 예시다. */
const CAST = [
  { id: 'kyle',  name: '카일', color: [92, 124, 168],  accent: [214, 196, 168], occupation: '경비병',
    speechStyle: '군인처럼 짧고 딱딱한 하오체. 변명은 길어진다', mbti: 'ISTJ',
    traits: ['원칙적', '초조함을 숨긴다'], background: '동문 초소를 3년째 지켰다. 어젯밤 잠깐 자리를 비웠다' },
  { id: 'mira',  name: '미라', color: [168, 120, 148], accent: [232, 208, 188], occupation: '시녀',
    speechStyle: '조심스러운 존댓말. 말끝을 흐린다', mbti: 'INFP',
    traits: ['겁이 많다', '다독이면 열린다'], background: '성주 부인을 모신다. 밤마다 누군가를 몰래 만났다' },
  { id: 'dorn',  name: '도른', color: [140, 116, 84],  accent: [204, 180, 140], occupation: '떠돌이 상인',
    speechStyle: '능글맞은 반말. 질문을 질문으로 되돌린다', mbti: 'ENTP',
    traits: ['말이 많다', '거짓이 자연스럽다'], background: '두 달에 한 번 성을 지난다. 금지된 물건을 나른 적이 있다' },
  { id: 'howell', name: '하웰', color: [156, 108, 92], accent: [220, 196, 172], occupation: '요리사',
    speechStyle: '투박한 반말. 남 얘기를 잘 옮긴다', mbti: 'ESFP',
    traits: ['소문을 옮긴다', '약점을 잡히면 흔들린다'], background: '부엌을 관리한다. 곳간에서 없어진 것을 알고 있다' },
  { id: 'ben',   name: '벤',   color: [104, 132, 108], accent: [200, 200, 184], occupation: '마부',
    speechStyle: '말수가 적다. 묻는 것만 답한다', mbti: 'ISTP',
    traits: ['무뚝뚝', '다그치면 닫힌다'], background: '뒷마당 마구간에서 지낸다. 밤에 말이 울었다' },
];

/** 게임이 실제로 쓰는 시트 목록 */
const SHEETS = [
  { key: 'idle',      state: 'IDLE',  frames: 4, emote: null },
  { key: 'walk',      state: 'WALK',  frames: 6, emote: null, gait: true },
  { key: 'rest',      state: 'REST',  frames: 4, emote: null, sit: true },
  { key: 'thinking',  state: 'EMOTE', frames: 4, emote: 'thinking' },
  { key: 'surprised', state: 'EMOTE', frames: 4, emote: 'surprised' },
  { key: 'proud',     state: 'EMOTE', frames: 4, emote: 'proud' },
  { key: 'greet',     state: 'EMOTE', frames: 4, emote: 'greet' },
];

const FRAME = 64;
let files = 0;

for (const c of CAST) {
  for (const s of SHEETS) {
    const columns = s.frames;
    const rows = 1;
    const { buf, W, H } = drawFrames({
      frameSize: FRAME, totalFrames: s.frames, columns, rows,
      color: c.color, accent: c.accent, emote: s.emote, gait: s.gait, sit: s.sit,
    });
    const meta = {
      characterId: c.id,
      characterName: c.name,
      state: s.state,
      clipId: `fixture_${c.id}_${s.key}`,
      duration: s.frames / 8,
      fps: 8,
      totalFrames: s.frames,
      frameWidth: FRAME,
      frameHeight: FRAME,
      columns,
      rows,
      sheetWidth: W,
      sheetHeight: H,
      background: 'transparent',
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      exportDate: '2026-08-18T00:00:00.000Z',
      _fixture: true,   // 진짜 export 로 바꿨는지 구분용
    };
    await writeFile(resolve(OUT, `${c.id}_${s.key}_sheet.png`), encodePng(W, H, buf));
    await writeFile(resolve(OUT, `${c.id}_${s.key}_sheet.json`), `${JSON.stringify(meta, null, 2)}\n`);
    files += 2;
  }

  // 캐릭터 JSON — SPUM Export 탭 C 의 형태를 따른다
  const charJson = {
    id: c.id,
    schemaVersion: 3,
    name: c.name,
    version: '1.0.0',
    license: 'cc-by',
    persona: {
      occupation: c.occupation, mbti: c.mbti, age: null, gender: '',
      personality: c.traits, traits: c.traits,
      speechStyle: c.speechStyle, background: c.background,
    },
    profiles: { village: { role: c.occupation, mood: 'calm', schedule: [] } },
    animation: {
      idle: `fixture_${c.id}_idle`, walk: `fixture_${c.id}_walk`,
      rest: `fixture_${c.id}_rest`, sleep: '',
      emotes: { happy: '', greet: `fixture_${c.id}_greet`, surprised: `fixture_${c.id}_surprised`,
                thinking: `fixture_${c.id}_thinking`, proud: `fixture_${c.id}_proud` },
    },
    _fixture: true,
  };
  await writeFile(resolve(OUT, `${c.id}_character.json`), `${JSON.stringify(charJson, null, 2)}\n`);
  files += 1;
}

// 인물 목록 — 로더가 무엇을 읽을지 알려주는 색인
await writeFile(resolve(OUT, 'index.json'),
  `${JSON.stringify({ cast: CAST.map((c) => c.id), sheets: SHEETS.map((s) => s.key), _fixture: true }, null, 2)}\n`);
files += 1;

console.log(`[fixture] ${files}개 파일 생성 → web/game/assets/characters/`);
console.log(`[fixture] 캐릭터 ${CAST.length}명 × 시트 ${SHEETS.length}종 (${FRAME}x${FRAME}, 8fps)`);
console.log('[fixture] 진짜 SPUM export 로 교체할 때: 같은 이름으로 덮어쓰면 됩니다.');
console.log('[fixture]   <id>_<key>_sheet.png / <id>_<key>_sheet.json / <id>_character.json');
