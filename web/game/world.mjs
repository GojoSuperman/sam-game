/**
 * 낮의 성 — 살아 있는 월드 시뮬레이션.
 *
 * 이 게임에는 시간선이 둘이다.
 *   밤 21~02시  범행 시간선. 과거이고 truth 테이블에만 있다. 보이지 않는다.
 *   낮 10~16시  심문하는 날. 인물들이 성 안을 돌아다니고 서로 마주친다. 이게 보인다.
 *
 * 낮의 움직임은 장식이 아니라 정보다:
 *   - 누가 누구와 단둘이 있었는지가 낮 피드에 남는다 (무슨 말이 오갔는지는 안 나온다)
 *   - 첩자는 낮에 공범과 단둘이 마주쳐야 거짓 목격을 심을 수 있다
 *   그래서 피드를 잘 보면 포섭 시점을 짚을 수 있다. 알려주지는 않는다.
 *
 * 좌표계는 캔버스 픽셀. 성은 3×3 격자이고 안뜰이 중앙 허브다 —
 * 다른 방으로 가려면 안뜰을 지나므로 이동이 눈에 보인다.
 */

import { ROOMS, RKO, HOURS } from './case.mjs';

/**
 * 논리 화면 크기 = 타일맵 크기. TILE 16 × GRID 48×32.
 * 방 좌표는 전부 16 배수에 스냅되어 있어 벽이 타일 경계와 맞는다 —
 * 어긋나면 벽이 타일 반쪽을 먹어 지저분해진다.
 */
export const STAGE = Object.freeze({ w: 768, h: 512 });

/** 방 배치 (16px 그리드 스냅). 문(door)은 안뜰을 향한다. */
export const LAYOUT = Object.freeze({
  archive:  { x: 48,  y: 32,  w: 192, h: 112, door: { x: 144, y: 144 }, ko: '서고' },
  quarters: { x: 528, y: 32,  w: 192, h: 112, door: { x: 624, y: 144 }, ko: '숙소' },
  gate:     { x: 48,  y: 192, w: 192, h: 112, door: { x: 240, y: 240 }, ko: '동문 초소' },
  court:    { x: 288, y: 192, w: 192, h: 112, door: { x: 384, y: 240 }, ko: '안뜰' },
  kitchen:  { x: 48,  y: 352, w: 192, h: 112, door: { x: 144, y: 336 }, ko: '부엌' },
  yard:     { x: 528, y: 352, w: 192, h: 112, door: { x: 624, y: 336 }, ko: '뒷마당' },
});

export const HUB = Object.freeze({ x: 384, y: 248 });
export const DAY_HOURS = Object.freeze(['10시', '11시', '12시', '13시', '14시', '15시']);

/** 방 안에서 인물이 설 자리 — 겹치지 않게 흩는다 */
function slot(roomId, index) {
  const r = LAYOUT[roomId];
  const cols = 3;
  const cx = r.x + 34 + (index % cols) * 52;
  const cy = r.y + 52 + Math.floor(index / cols) * 40;
  return { x: Math.min(cx, r.x + r.w - 24), y: Math.min(cy, r.y + r.h - 14) };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** 방 안 임의 지점. 가구를 피하려고 가장자리를 조금 물린다. */
function spotIn(roomId, rng) {
  const r = LAYOUT[roomId];
  return {
    x: r.x + 24 + rng() * (r.w - 48),
    y: r.y + r.h - 12 - rng() * (r.h * 0.42),
  };
}

/** 낮에 오가는 짧은 말. 사건 정보는 절대 담지 않는다 — 분위기만. */
const CHATTER = [
  '오늘 바람이 차네.', '아침부터 어수선하군.', '문서 얘기는 들었소?',
  '심문관이 왔다더군.', '난 아무것도 못 봤소.', '괜히 엮이고 싶지 않네.',
  '어젯밤은 조용했지.', '그 사람 표정이 안 좋았어.', '일이나 하세.',
  '누가 그랬을까.', '나는 관계없소.', '해가 지기 전에 끝나겠지.',
];

/**
 * @param kase case.mjs 의 사건
 * @param rng  시드 RNG (재현 가능한 낮을 위해)
 */
export function createWorld(kase, rng = Math.random) {
  const actors = {};
  kase.cast.forEach((id, i) => {
    // 시작 위치는 서로 다른 방에 흩는다
    const roomId = ROOMS[i % ROOMS.length].id;
    const p = slot(roomId, 0);
    actors[id] = {
      id,
      room: roomId,
      x: p.x, y: p.y,
      /** idle | walk | rest | talk */
      state: 'idle',
      /** 걷는 중이면 남은 경로 */
      path: [],
      facing: 1,
      /** 이 행동을 언제까지 하는가 (ms) */
      until: 0,
      /** 화면에 뜨는 행동 라벨 */
      activity: '서 있다',
      partner: null,
      bubble: '',
      bubbleUntil: 0,
    };
  });

  const world = {
    kase,
    actors,
    beat: 0,
    /** 낮 피드 — 누가 누구와 어디 있었는지만 남는다 */
    feed: [],
    /** 포섭이 성립한 beat (플레이어에게 알려주지 않는다) */
    recruitBeat: null,
    rng,
  };

  // 포섭 beat 를 미리 잡는다. 사건에 이미 공범이 정해져 있으므로,
  // 낮 시뮬레이션이 그 만남을 반드시 만들어 주어야 앞뒤가 맞는다.
  if (kase.accomplice) {
    world.recruitBeat = 3 + Math.floor(rng() * 8); // 18 beat 중 중반
  }
  return world;
}

const ACTIVITIES = {
  archive:  ['서가를 살핀다', '먼지를 턴다', '책을 넘긴다'],
  quarters: ['침구를 정리한다', '창밖을 본다', '앉아 쉰다'],
  gate:     ['성문을 살핀다', '창을 세워 둔다', '길을 내다본다'],
  court:    ['우물가에 선다', '햇볕을 쬔다', '지나가는 이를 본다'],
  kitchen:  ['불을 지킨다', '냄비를 젓는다', '곳간을 살핀다'],
  yard:     ['장작을 옮긴다', '말을 달랜다', '빨래를 걷는다'],
};

function pickActivity(roomId, rng) {
  const list = ACTIVITIES[roomId] || ['서 있다'];
  return list[Math.floor(rng() * list.length)];
}

/** 방 A → 방 B 경로. 같은 방이 아니면 안뜰을 지난다. */
function routeTo(fromRoom, toRoom) {
  if (fromRoom === toRoom) return [];
  const a = LAYOUT[fromRoom];
  const b = LAYOUT[toRoom];
  const wp = [a.door];
  if (fromRoom !== 'court' && toRoom !== 'court') wp.push(HUB);
  wp.push(b.door);
  return wp;
}

/** 인물을 다른 방으로 보낸다 */
export function sendTo(world, id, roomId) {
  const a = world.actors[id];
  if (!a || a.room === roomId) return;
  a.path = [...routeTo(a.room, roomId), spotIn(roomId, world.rng)];
  a.room = roomId;         // 목적지를 미리 방으로 잡아 둔다 (판정은 도착 시)
  a.state = 'walk';
  a.activity = `${RKO[roomId]}(으)로 간다`;
  a.partner = null;
}

/**
 * 한 beat(심문 1회)마다 낮이 진행된다.
 * 일부는 방을 옮기고, 같은 방에 둘만 있으면 대화가 성립한다.
 */
export function advanceBeat(world) {
  const { kase, actors, rng } = world;
  world.beat += 1;
  const hour = DAY_HOURS[Math.min(DAY_HOURS.length - 1, Math.floor((world.beat - 1) / 3))];

  // 포섭 beat 라면 첩자와 공범을 같은 방으로, 다른 사람은 그 방에서 뺀다
  if (world.recruitBeat === world.beat && kase.accomplice) {
    const room = ROOMS[Math.floor(rng() * ROOMS.length)].id;
    sendTo(world, kase.spy, room);
    sendTo(world, kase.accomplice, room);
    for (const id of kase.cast) {
      if (id === kase.spy || id === kase.accomplice) continue;
      if (actors[id].room === room) {
        const other = ROOMS.filter((r) => r.id !== room);
        sendTo(world, id, other[Math.floor(rng() * other.length)].id);
      }
    }
  } else {
    // 평소: 40% 확률로 옮긴다
    for (const id of kase.cast) {
      if (rng() < 0.4) {
        const dest = ROOMS[Math.floor(rng() * ROOMS.length)].id;
        sendTo(world, id, dest);
      }
    }
  }

  // 만남 기록 — 같은 방에 있는 조합. 무슨 말이 오갔는지는 남기지 않는다.
  const byRoom = {};
  for (const id of kase.cast) { actors[id].partner = null; (byRoom[actors[id].room] ??= []).push(id); }
  const met = [];
  for (const [roomId, ids] of Object.entries(byRoom)) {
    if (ids.length < 2) continue;
    met.push({ room: roomId, ids: ids.slice() });
    // 단둘이면 마주 서게 서로를 향해 붙인다
    if (ids.length === 2) {
      const [a, b] = ids.map((i) => actors[i]);
      a.partner = ids[1]; b.partner = ids[0];
      const r = LAYOUT[roomId];
      const midY = r.y + r.h - 20 - rng() * (r.h * 0.3);
      const midX = r.x + 40 + rng() * (r.w - 80);
      a.path = [...(a.path.length ? a.path.slice(0, -1) : []), { x: midX - 20, y: midY }];
      b.path = [...(b.path.length ? b.path.slice(0, -1) : []), { x: midX + 20, y: midY }];
      a.state = 'walk'; b.state = 'walk';
    } else {
      for (const i of ids) actors[i].partner = null;
    }
  }
  for (const m of met) {
    world.feed.unshift({
      beat: world.beat, hour, room: m.room, ids: m.ids,
      text: `${m.ids.map((i) => i).join(' · ')} — ${RKO[m.room]}`,
    });
  }
  world.feed = world.feed.slice(0, 24);
  return { hour, met };
}

/** 매 프레임 — 이동과 행동을 갱신한다 */
export function step(world, now, dt) {
  const SPEED = 0.055; // px/ms
  for (const a of Object.values(world.actors)) {
    if (a.path.length) {
      const target = a.path[0];
      const d = dist(a, target);
      const move = SPEED * dt;
      if (d <= move) {
        a.x = target.x; a.y = target.y;
        a.path.shift();
        if (!a.path.length) {
          a.state = a.partner ? 'talk' : 'idle';
          a.activity = a.partner ? '이야기한다' : pickActivity(a.room, world.rng);
          a.until = now + 2000 + world.rng() * 3000;
        }
      } else {
        const k = move / d;
        if (target.x !== a.x) a.facing = target.x > a.x ? 1 : -1;
        a.x += (target.x - a.x) * k;
        a.y += (target.y - a.y) * k;
        a.state = 'walk';
      }
      continue;
    }
    // 대화 상대를 향해 선다
    if (a.partner) {
      const p = world.actors[a.partner];
      if (p && !p.path.length) a.facing = p.x >= a.x ? 1 : -1;
    }

    // 제자리에서 행동을 바꾼다 — 가만히 서 있으면 죽은 화면이 된다
    if (now > a.until) {
      const roll = world.rng();
      if (a.partner) {
        a.state = 'talk';
        a.activity = '이야기한다';
        // 둘 중 한쪽만 말풍선을 띄운다
        if (roll < 0.5) {
          a.bubble = CHATTER[Math.floor(world.rng() * CHATTER.length)];
          a.bubbleUntil = now + 2600;
        }
        a.until = now + 2200 + world.rng() * 2600;
      } else if (roll < 0.34) {
        // 방 안을 어슬렁거린다 — 슬롯에 붙어 있으면 마네킹처럼 보인다
        a.path = [spotIn(a.room, world.rng)];
        a.state = 'walk';
        a.activity = pickActivity(a.room, world.rng);
        a.until = now + 3000;
      } else {
        a.state = roll < 0.5 ? 'rest' : 'idle';
        a.activity = a.state === 'rest' ? '앉아 쉰다' : pickActivity(a.room, world.rng);
        a.until = now + 2500 + world.rng() * 4000;
      }
    }
    if (a.bubbleUntil && now > a.bubbleUntil) { a.bubble = ''; a.bubbleUntil = 0; }
  }
}

/** 좌표가 어느 인물을 가리키는가 (클릭 판정) */
export function actorAt(world, x, y, radius = 26) {
  let best = null; let bd = radius;
  for (const a of Object.values(world.actors)) {
    const d = Math.hypot(a.x - x, a.y - (y - 20));
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

/** 방 안에 있는 인물 목록 */
export function inRoom(world, roomId) {
  return Object.values(world.actors).filter((a) => a.room === roomId && !a.path.length).map((a) => a.id);
}
