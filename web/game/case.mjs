/**
 * 사건 생성 — 이 게임의 "진실". LLM 은 여기에 손댈 수 없다.
 *
 * 설계 원칙 (seogo 원안을 따른다):
 *   - 목격은 같은 방에서만 성립한다. 안 가 본 방은 "모른다"다.
 *   - 첩자는 한 시각에 거짓 알리바이를 댄다.
 *   - 공범은 그 시각 그 방에 없었으므로 반드시 구멍이 남는다.
 */

export const ROOMS = Object.freeze([
  { id: 'archive',  ko: '서고' },
  { id: 'court',    ko: '안뜰' },
  { id: 'kitchen',  ko: '부엌' },
  { id: 'gate',     ko: '동문 초소' },
  { id: 'yard',     ko: '뒷마당' },
  { id: 'quarters', ko: '숙소' },
]);
export const HOURS = Object.freeze(['21시', '22시', '23시', '00시', '01시', '02시']);
export const RKO = Object.freeze(Object.fromEntries(ROOMS.map((r) => [r.id, r.ko])));

/** 심문 예산 — 6틱 × 3회 */
export const TICKS = 6;
export const PER_TICK = 3;
export const BEATS = TICKS * PER_TICK;

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const shuffle = (rng, arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** 시드 고정 RNG — 같은 시드면 같은 사건이 나온다 (재현 가능한 테스트를 위해) */
export function makeRng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

/**
 * @param castIds 다섯 인물의 id (SPUM 캐릭터 id 를 그대로 쓴다)
 * @returns 진실 테이블 + 첩자/공범/절도 정보
 */
export function newCase(castIds, { seed = Date.now() } = {}) {
  if (!Array.isArray(castIds) || castIds.length < 5) {
    throw new Error(`인물이 5명 필요합니다 (현재 ${castIds?.length ?? 0}명)`);
  }
  const rng = makeRng(seed);
  const cast = castIds.slice(0, 5);

  // 1) 진짜 동선 — 인물 × 시각 → 방
  const truth = {};
  for (const id of cast) {
    truth[id] = {};
    let room = pick(rng, ROOMS).id;
    for (const h of HOURS) {
      // 60% 는 머무르고 40% 는 옮긴다. 옮기면 동선이 자연스럽다.
      if (rng() < 0.4) room = pick(rng, ROOMS).id;
      truth[id][h] = room;
    }
  }

  // 2) 첩자와 절도 시각 — 절도 시각에 첩자는 서고에 있어야 한다
  const spy = pick(rng, cast);
  const theftHour = pick(rng, HOURS.slice(1, 5)); // 22~01시 사이
  truth[spy][theftHour] = 'archive';

  // 3) 첩자가 거짓말할 시각 = 절도 시각. 알리바이로 댈 가짜 방
  const fakeRoom = pick(rng, ROOMS.filter((r) => r.id !== 'archive')).id;

  // 4) 공범 — 절도 시각에 fakeRoom 에 없었던 사람 중 하나
  const candidates = cast.filter((id) => id !== spy && truth[id][theftHour] !== fakeRoom);
  const accomplice = candidates.length ? pick(rng, candidates) : null;

  // 5) 심어진 거짓 목격: 공범이 "theftHour 에 fakeRoom 에서 spy 를 봤다"고 말한다.
  //    공범의 실제 위치는 fakeRoom 이 아니므로 다른 각도로 물으면 어긋난다 — 그게 구멍이다.
  const plant = accomplice ? {
    speaker: accomplice,
    hour: theftHour,
    room: fakeRoom,
    saw: spy,
    actualRoom: truth[accomplice][theftHour],
  } : null;

  // 6) 무고한 비밀 — 거짓말하지만 첩자는 아닌 사람들
  const secrets = {};
  const secretPool = [
    { kind: 'post', text: '초소를 비웠다' },
    { kind: 'meet', text: '몰래 사람을 만났다' },
    { kind: 'goods', text: '금지된 물건을 옮겼다' },
    { kind: 'theftKnown', text: '곳간에서 없어진 것을 안다' },
    { kind: 'debt', text: '빚 때문에 협박받았다' },
  ];
  const pool = shuffle(rng, secretPool);
  cast.forEach((id, i) => { secrets[id] = pool[i % pool.length]; });

  // 7) 목격자 판정.
  //    공범은 절도 시각에 서고에 있었을 수 있다(실측 약 40%). 그 경우 그는
  //    "본" 사람이긴 하지만 거짓을 말하므로, 거짓이 깨지기 전에는 목격자로
  //    인정하면 안 된다. 정직한 목격자와 분리해서 들고 다닌다.
  const inArchive = witnessFor(truth, cast, spy, theftHour);
  const honestWitness = inArchive.filter((id) => id !== accomplice);
  const brokenWitness = inArchive.filter((id) => id === accomplice);

  return {
    seed,
    cast,
    truth,
    spy,
    theftHour,
    fakeRoom,
    accomplice,
    plant,
    secrets,
    solution: {
      spy,
      hour: theftHour,
      /** 그냥 물어도 증언해 주는 목격자 */
      witness: honestWitness,
      /** 거짓을 깨야 비로소 증언이 되는 목격자 (= 공범). 없을 수도 있다 */
      witnessAfterBreak: brokenWitness,
    },
  };
}

/**
 * 지목 판정. 공범을 목격자로 지목한 경우는 그의 거짓을 깼는지에 달렸다.
 * @param broken 플레이어가 거짓을 깬 인물 id 집합
 */
export function judgeAccusation(kase, { spy, hour, witness }, broken = new Set()) {
  const okSpy = spy === kase.solution.spy;
  const okHour = hour === kase.solution.hour;
  const honest = kase.solution.witness.includes(witness);
  const needsBreak = kase.solution.witnessAfterBreak.includes(witness);
  const okWitness = honest || (needsBreak && broken.has(witness));
  return {
    win: okSpy && okHour && okWitness,
    okSpy,
    okHour,
    okWitness,
    /** 목격자를 틀린 이유를 구분해서 알려준다 */
    witnessReason: okWitness ? 'ok'
      : needsBreak ? 'lie-not-broken'
        : 'not-a-witness',
  };
}

/**
 * 첩자가 절도 시각에 서고에 있었다는 것을 증명할 수 있는 사람 =
 * 그 시각 서고에 같이 있던 사람. 없으면 null (그 경우 사건을 다시 뽑아야 한다).
 */
export function witnessFor(truth, cast, spy, hour) {
  return cast.filter((id) => id !== spy && truth[id][hour] === 'archive');
}

/** 목격자가 없는 사건은 풀 수 없다. 있는 사건이 나올 때까지 다시 뽑는다. */
export function newSolvableCase(castIds, { seed = Date.now(), maxTries = 400 } = {}) {
  for (let i = 0; i < maxTries; i += 1) {
    const c = newCase(castIds, { seed: seed + i });
    // 정직한 목격자가 최소 1명 있어야 한다. 공범만 서고에 있었다면
    // 플레이어가 먼저 공범의 거짓을 깨야만 풀리는 사건이 되어 난이도가 튄다.
    if (c.solution.witness.length >= 1 && c.accomplice && c.plant) return c;
  }
  throw new Error(`풀 수 있는 사건을 ${maxTries}번 안에 못 만들었습니다`);
}

/**
 * 어떤 인물이 어떤 시각에 대해 "정직하게" 말할 수 있는 것.
 * 이것이 LLM 검증의 허용 목록이 된다.
 */
export function honestKnowledge(kase, id, hour) {
  const room = kase.truth[id][hour];
  const others = kase.cast.filter((o) => o !== id && kase.truth[o][hour] === room);
  return { hour, room, saw: others };
}

/** 인물이 실제로 말할 내용 — 첩자의 거짓말과 공범의 심어진 말을 반영한다 */
export function statementOf(kase, id, hour) {
  if (id === kase.spy && hour === kase.theftHour) {
    return { hour, room: kase.fakeRoom, saw: [], lie: true, reason: 'spy-alibi' };
  }
  if (kase.plant && id === kase.plant.speaker && hour === kase.plant.hour) {
    return { hour, room: kase.plant.room, saw: [kase.plant.saw], lie: true, reason: 'planted' };
  }
  const k = honestKnowledge(kase, id, hour);
  return { ...k, lie: false, reason: 'honest' };
}

/**
 * 들이대기 — "당신은 그 시각 그 방에 없었소."
 *
 * 왜 이 장치가 필수인가:
 *   첩자와 공범은 판에서 **똑같은 모양의 모순**을 만든다. 둘 다 절도 시각에
 *   fakeRoom 을 주장하고, 다른 사람들은 둘을 각자의 실제 방에서 봤다고 증언한다.
 *   그래서 증언판만으로는 어느 쪽이 첩자인지 가릴 수 없다.
 *   (자동 플레이 실측: 이 장치 없이 완전 정보를 줘도 승률 84.5%에서 멈춘다.)
 *
 *   공범은 자기가 가 보지도 않은 방을 봤다고 말한 것이므로, 그 지점을 찔리면
 *   버틸 근거가 없다. 실토하면서 시킨 사람을 댄다 — 이것이 첩자를 특정하는 정보다.
 *   첩자는 실토하지 않는다.
 *
 * @param hour 들이대는 시각
 * @returns {{ kind:'confess'|'deny'|'nothing', names?:string, actualRoom?:string, claimedRoom?:string, secret?:object }}
 */
export function confront(kase, id, hour) {
  // 공범을 그의 거짓 시각에 찔렀을 때만 실토한다
  if (kase.plant && id === kase.plant.speaker && hour === kase.plant.hour) {
    return {
      kind: 'confess',
      names: kase.plant.saw,              // 시킨 사람 = 첩자
      actualRoom: kase.plant.actualRoom,  // 진짜 있던 곳
      claimedRoom: kase.plant.room,       // 봤다고 주장한 곳
      secret: kase.secrets[id],           // 붙잡힌 약점
    };
  }
  // 첩자를 절도 시각에 찔렀을 때 — 부인한다. 다만 부인 자체가 신호가 된다.
  if (id === kase.spy && hour === kase.theftHour) {
    return { kind: 'deny', claimedRoom: kase.fakeRoom };
  }
  // 무고한 사람 — 숨긴 비밀이 있으면 그것만 나온다. 문서는 훔치지 않았다.
  return { kind: 'nothing', secret: kase.secrets[id] };
}

/** 그 인물·시각을 들이댈 근거가 있는가 (판에 모순이 올라와 있는가) */
export function confrontable(board, id, hour) {
  const rooms = new Set((board?.[id]?.[hour] || []).map((c) => (typeof c === 'string' ? c : c.room)));
  return rooms.size > 1;
}
