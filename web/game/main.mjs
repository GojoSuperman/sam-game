/**
 * 서고의 밤 — 부트 · 낮 시뮬레이션 · 심문 · UI.
 *
 * 모듈 역할:
 *   case.mjs      밤의 진실 (LLM 이 못 건드림) + 들이대기
 *   world.mjs     낮의 성 — 방 배치, 이동, 행동, 만남 피드
 *   facts.mjs     허용 사실 계산 + 대사 검증 (사실 + 말투)
 *   dialogue.mjs  SAM 호출 (프록시 경유) + 결정론 폴백
 *   sprite.mjs    SPUM Export 스프라이트 렌더
 */
import {
  HOURS, ROOMS, RKO, BEATS,
  newSolvableCase, statementOf, judgeAccusation, confront, confrontable,
} from './case.mjs';
import * as D from './dialogue.mjs';
import { loadCharacter, drawSprite } from './sprite.mjs';
import {
  STAGE, LAYOUT, DAY_HOURS, createWorld, advanceBeat, step, actorAt, inRoom,
} from './world.mjs';
import { buildCastleLayer, drawLighting, drawShadow, drawDust, drawBubble } from './render.mjs';

const SHEET_KEYS = ['idle', 'walk', 'rest', 'thinking', 'surprised', 'proud', 'greet'];
const el = (id) => document.getElementById(id);

/** 말투 서명 — persona.speechStyle 은 자연어라 검사에 못 쓴다. 검사 가능한 형태로 옮긴 것. */
const SIGNATURES = {
  kyle:   { endings: ['소', '오', '다'], banned: ['ㅋ', '아마'], maxSentences: 2, maxChars: 46 },
  mira:   { endings: ['요', '까', '데'], banned: ['ㅋ'],         maxSentences: 2, maxChars: 46 },
  dorn:   { endings: ['지', '나', '군', '데', '어'], banned: ['ㅋ'], maxSentences: 2, maxChars: 50 },
  howell: { endings: ['어', '지', '네', '다'], banned: ['ㅋ'],   maxSentences: 2, maxChars: 46 },
  ben:    { endings: ['소', '다', '오'], banned: ['ㅋ'],         maxSentences: 1, maxChars: 34 },
};
const DEFAULT_SIG = { endings: [], banned: ['ㅋ'], maxSentences: 2, maxChars: 46 };

const G = {
  kase: null, world: null,
  chars: {}, names: {},
  sel: null,
  beats: BEATS,
  board: {}, known: {}, broken: new Set(),
  emote: {},
  busy: false, over: false,
  lastT: 0,
  /** 성의 정적 층 — 한 번만 그려 캐시한다 */
  castleLayer: null,
  stageScale: 1,
  stageOffset: { x: 0, y: 0 },
};

// ─────────────────────────────────────────────────────────── 부트
async function boot() {
  const index = await (await fetch('./assets/characters/index.json')).json();
  const castIds = index.cast;
  const problems = [];
  let fixtures = 0;

  for (const id of castIds) {
    const c = await loadCharacter(id, SHEET_KEYS);
    G.chars[id] = c;
    G.names[id] = c.name;
    problems.push(...c.problems);
    if (c.isFixture) fixtures += 1;
  }
  el('assetState').textContent = problems.length ? `자산 문제 ${problems.length}건`
    : fixtures ? `합성 자산 ${fixtures}명` : `SPUM 자산 ${castIds.length}명`;
  el('assetState').className = `pill ${problems.length ? 'pill--bad' : fixtures ? 'pill--wait' : 'pill--ok'}`;

  const h = await D.health();
  if (h.ok) {
    el('samState').textContent = `SAM 프록시 · ${h.preset}`;
    el('samState').className = 'pill pill--ok';
  } else {
    el('samState').textContent = '프록시 없음 — 결정론 모드';
    el('samState').className = 'pill pill--bad';
    D.state.enabled = false;
  }

  newGame(castIds);
  bindStage();
  fitStage();
  window.addEventListener('resize', fitStage);
  el('togglePanel').addEventListener('click', () => {
    document.body.classList.toggle('panel-off');
    el('togglePanel').title = document.body.classList.contains('panel-off') ? '우측 패널 펼치기' : '우측 패널 접기';
  });
  requestAnimationFrame(loop);

  diag([
    `자산: ${castIds.length}명 × 시트 ${SHEET_KEYS.length}종`,
    fixtures ? `합성(fixture) ${fixtures}명 — SPUM Export 로 교체하세요` : 'SPUM Export 자산',
    ...problems.map((p) => `자산 문제: ${p}`),
    `프록시: ${h.ok ? `OK (${h.preset})` : `실패 — ${h.detail}`}`,
  ].join('\n'));
}

function newGame(castIds) {
  const seed = Math.floor(Math.random() * 1e9);
  G.kase = newSolvableCase(castIds, { seed });
  // 낮 시뮬레이션도 같은 시드에서 파생 — 재현 가능하게
  let s = seed >>> 0 || 1;
  const rng = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 0x100000000; };
  G.world = createWorld(G.kase, rng);

  G.beats = BEATS;
  G.board = {}; G.known = {}; G.broken = new Set(); G.over = false;
  for (const id of castIds) { G.board[id] = {}; G.known[id] = []; }
  G.sel = castIds[0];

  el('log').innerHTML = '';
  el('result').textContent = ''; el('result').className = 'result';
  say('sys', '어젯밤 21시부터 02시 사이, 성의 서고에서 기밀 문서가 사라졌다. 성문은 닫혀 있었다.');
  say('sys', `당신은 아침에 도착한 심문관이다. 심문 ${BEATS}번, 지목은 한 번.`);
  say('sys', '목격은 같은 방에서만 성립한다. 안 가 본 방은 "모른다"고 답한다.');
  say('sys', '성 안의 인물을 눌러 상대를 고른다. 낮 동안 그들도 돌아다닌다.');
  buildAccuse(); renderBoard(); renderHUD(); renderHints(); renderFeed();
}

// ─────────────────────────────────────────────────────── 렌더 (성)
function drawCastle(ctx) {
  G.castleLayer ??= buildCastleLayer();
  ctx.drawImage(G.castleLayer, 0, 0);

  // 방 라벨과 선택 강조만 매 프레임 — 상태에 따라 바뀌므로 캐시할 수 없다
  for (const [id, r] of Object.entries(LAYOUT)) {
    const here = inRoom(G.world, id);
    const hasSel = here.includes(G.sel);
    if (hasSel) {
      ctx.strokeStyle = 'rgba(127,180,232,.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
      ctx.lineWidth = 1;
    }
    ctx.font = `${hasSel ? 'bold ' : ''}11px "Noto Sans KR",sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillText(r.ko, r.x + 7, r.y + r.h - 7);
    ctx.fillStyle = hasSel ? '#9fcaf0' : '#6d7784';
    ctx.fillText(r.ko, r.x + 6, r.y + r.h - 8);
    if (here.length) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#59616d';
      ctx.fillText(`${here.length}`, r.x + r.w - 6, r.y + r.h - 8);
    }
  }
}

function drawActors(ctx, t) {
  const actors = Object.values(G.world.actors).slice().sort((a, b) => a.y - b.y);

  for (const a of actors) {
    const c = G.chars[a.id];
    const e = G.emote[a.id];
    const key = e && e.until > t ? e.key
      : a.state === 'walk' ? 'walk'
        : a.state === 'rest' ? 'rest'
          : a.state === 'talk' ? 'greet' : 'idle';
    const entry = c.sheets[key] || c.sheets.idle;
    const w = entry?.sheet.frameWidth || 64;

    drawShadow(ctx, a.x, a.y, 20);
    if (a.state === 'walk') drawDust(ctx, a.x, a.y, t);
    drawSprite(ctx, entry, { x: a.x - w / 2, y: a.y, scale: 1, elapsedMs: t, flip: a.facing < 0 });

    const isSel = a.id === G.sel;
    ctx.font = `${isSel ? 'bold ' : ''}11px "Noto Sans KR",sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillText(c.name, a.x + 1, a.y + 13);
    ctx.fillStyle = isSel ? '#9fcaf0' : '#a4aeba';
    ctx.fillText(c.name, a.x, a.y + 12);
    if (isSel) {
      ctx.strokeStyle = 'rgba(127,180,232,.75)';
      ctx.beginPath(); ctx.ellipse(a.x, a.y, 17, 6, 0, 0, Math.PI * 2); ctx.stroke();
    }
    // 대화 중인 둘 사이 연결선
    if (a.partner && G.world.actors[a.partner] && !a.path.length) {
      const p = G.world.actors[a.partner];
      if (!p.path.length) {
        ctx.strokeStyle = 'rgba(232,192,127,.28)';
        ctx.beginPath(); ctx.moveTo(a.x, a.y - 24); ctx.lineTo(p.x, p.y - 24); ctx.stroke();
      }
    }
  }
  // 말풍선은 전부 위에 — 스프라이트에 가리지 않게
  for (const a of actors) {
    if (a.bubble && a.bubbleUntil > t) drawBubble(ctx, a.x, a.y, a.bubble);
  }
}

function loop(t) {
  const dt = Math.min(64, t - (G.lastT || t));
  G.lastT = t;
  step(G.world, t, dt);
  const ctx = el('stage').getContext('2d');
  drawCastle(ctx);
  drawActors(ctx, t);
  // 조명과 시간대 색조는 마지막에 — 인물 위에 얹혀야 한 공간으로 보인다
  drawLighting(ctx, t, G.world.beat / BEATS);
  renderWho();
  requestAnimationFrame(loop);
}

/**
 * 캔버스를 화면에 맞춘다.
 * 픽셀아트는 소수 배율로 늘리면 뭉개지므로 정수 배율만 쓴다.
 * 화면을 꽉 채우려면 cover(잘림 허용), 전체를 보려면 contain(여백 허용).
 * 배경 위에 UI 를 얹는 구성이므로 cover 로 채우고 살짝 잘리게 둔다.
 */
function fitStage() {
  const cv = el('stage');
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const raw = Math.max(vw / STAGE.w, vh / STAGE.h);   // cover
  const scale = Math.max(1, Math.floor(raw * 2) / 2); // 0.5 단위 — 1.5배 같은 것도 허용
  const w = Math.round(STAGE.w * scale);
  const h = Math.round(STAGE.h * scale);
  cv.style.width = `${w}px`;
  cv.style.height = `${h}px`;
  G.stageScale = scale;
  G.stageOffset = { x: (vw - w) / 2, y: (vh - h) / 2 };
}

function bindStage() {
  const cv = el('stage');
  cv.addEventListener('click', (ev) => {
    const r = cv.getBoundingClientRect();
    // rect 기준으로 나누면 CSS 배율·오프셋과 무관하게 논리 좌표가 나온다
    const x = (ev.clientX - r.left) * (cv.width / r.width);
    const y = (ev.clientY - r.top) * (cv.height / r.height);
    const a = actorAt(G.world, x, y);
    if (a) { G.sel = a.id; renderHints(); el('ask').focus(); return; }
    // 방을 누르면 그 방에 대해 묻는 문장을 채워 준다
    for (const [id, rc] of Object.entries(LAYOUT)) {
      if (x >= rc.x && x <= rc.x + rc.w && y >= rc.y && y <= rc.y + rc.h) {
        el('ask').value = `${rc.ko}엔 누가 드나들었소?`;
        el('ask').focus();
        return;
      }
    }
  });
}

// ─────────────────────────────────────────────────────────── UI
function renderWho() {
  const a = G.world.actors[G.sel];
  if (!a) return;
  const c = G.chars[G.sel];
  const p = c.persona || {};
  el('who').innerHTML = `<b>${c.name}</b> <span>${p.occupation || ''}</span>`
    + ` · <span class="room">${LAYOUT[a.room]?.ko || ''}</span>`
    + ` · <span class="act">${a.activity}</span>`
    + (a.partner ? ` · <span>${G.names[a.partner]}과 함께</span>` : '');
}

function renderHUD() {
  const hour = DAY_HOURS[Math.min(DAY_HOURS.length - 1, Math.floor(G.world.beat / 3))];
  el('clock').textContent = `낮 ${hour}`;
  el('beats').textContent = `심문 ${G.beats}회 남음`;
}

function renderFeed() {
  const f = G.world.feed;
  el('feed').innerHTML = f.length
    ? f.map((x) => `<div><span class="h">${x.hour}</span>`
      + `<span class="n">${x.ids.map((i) => G.names[i]).join(' · ')}</span> — ${RKO[x.room]}</div>`).join('')
    : '<div>아직 마주친 사람이 없다.</div>';
}

function buildAccuse() {
  const opt = (v, t) => `<option value="${v}">${t}</option>`;
  el('accSpy').innerHTML = G.kase.cast.map((id) => opt(id, `첩자: ${G.names[id]}`)).join('');
  el('accHour').innerHTML = HOURS.map((h) => opt(h, `시각: ${h}`)).join('');
  el('accWit').innerHTML = G.kase.cast.map((id) => opt(id, `목격자: ${G.names[id]}`)).join('');
}

function renderBoard() {
  let html = '<table><thead><tr><th>인물</th>'
    + HOURS.map((h) => `<th>${h.replace('시', '')}</th>`).join('') + '</tr></thead><tbody>';
  for (const id of G.kase.cast) {
    html += `<tr><th>${G.names[id]}</th>`;
    for (const h of HOURS) {
      const cells = G.board[id][h] || [];
      const rooms = [...new Set(cells.map((c) => c.room))];
      const conflict = rooms.length > 1;
      const marks = cells.map((c) => (c.kind === 'self' ? '●' : '○')).join('');
      const title = cells.map((c) => `${RKO[c.room]} (${c.kind === 'self' ? '본인' : `${G.names[c.by]} 목격`})`).join(' · ');
      html += `<td class="${conflict ? 'conflict' : cells.length ? 'has' : 'empty'}" title="${title}">`
        + `${cells.length ? rooms.map((r) => RKO[r][0]).join('/') + marks : '·'}</td>`;
    }
    html += '</tr>';
  }
  el('board').innerHTML = `${html}</tbody></table>`;
}

function renderHints() {
  const qs = ['어젯밤 어디 있었소?', '23시엔 누구를 봤소?', '서고엔 누가 드나들었소?', '당신은 그 시각 그 방에 없었소.'];
  el('hints').innerHTML = `<span>${G.names[G.sel]}에게:</span>`
    + qs.map((q) => `<button type="button" data-q="${q}">${q}</button>`).join('');
  for (const b of el('hints').querySelectorAll('button')) {
    b.onclick = () => { el('ask').value = b.dataset.q; el('ask').focus(); };
  }
}

function say(kind, text, extra = '') {
  const p = document.createElement('p');
  p.className = kind;
  p.innerHTML = kind === 'npc' ? text + (extra ? `<span class="src">${extra}</span>` : '') : text;
  el('log').appendChild(p);
  el('log').scrollTop = el('log').scrollHeight;
}
function diag(t) { el('diag').textContent = t; }
function emote(id, key) { G.emote[id] = { key, until: performance.now() + 2200 }; }

// ─────────────────────────────────────────────── 질문 해석 (결정론)
function parseQuestion(text) {
  const t = String(text || '');
  const hours = HOURS.filter((h) => t.includes(h) || t.includes(h.replace('시', '')));
  if (t.includes('자정')) hours.push('00시');
  const room = ROOMS.find((r) => t.includes(r.ko));
  return {
    hours: [...new Set(hours)],
    room: room?.id || null,
    asksWho: /누구|누가|봤|보았|목격/.test(t),
    asksWhere: /어디|있었|위치|행적/.test(t),
    confront: /없었|아니|거짓|시켰|왜/.test(t),
  };
}
function findContradictionHour(id) {
  return HOURS.find((h) => new Set((G.board[id]?.[h] || []).map((c) => c.room)).size > 1) || null;
}
function pickUnaskedHour(id) {
  const asked = new Set(Object.keys(G.board[id] || {}));
  return HOURS.find((h) => !asked.has(h)) || HOURS[0];
}
function addBoard(id, hour, room, kind, by) {
  G.board[id] ??= {}; G.board[id][hour] ??= [];
  const list = G.board[id][hour];
  if (!list.some((c) => c.room === room && c.kind === kind && c.by === by)) list.push({ room, kind, by });
}
function detectBroken() {
  for (const id of G.kase.cast) {
    for (const h of HOURS) {
      if (new Set((G.board[id][h] || []).map((c) => c.room)).size > 1 && !G.broken.has(id)) {
        G.broken.add(id);
        say('sys', `증언판: ${G.names[id]}의 ${h} 진술이 어긋난다. 같은 시각에 두 장소가 적혔다.`);
        emote(id, 'surprised');
      }
    }
  }
}

// ─────────────────────────────────────────────────────────── 심문
async function ask(text) {
  if (G.over || G.busy) return;
  const q = parseQuestion(text);
  const id = G.sel;
  const ch = G.chars[id];
  const sig = SIGNATURES[id] || DEFAULT_SIG;
  say('you', `<b>나</b> → ${ch.name}: ${text}`);
  G.busy = true; el('ask').disabled = true;

  try {
    // 들이대기 — 첩자와 공범을 가르는 유일한 장치
    if (q.confront) {
      const hour = q.hours[0] || findContradictionHour(id);
      if (!hour || !confrontable(G.board, id, hour)) {
        say('npc', `<b>${ch.name}</b>: 나는 그 자리에 있었소. 왜 그러시오?`, '근거 없음');
        say('sys', '들이대려면 먼저 증언판에 그 인물의 모순이 올라와 있어야 한다.');
        return;
      }
      const r = confront(G.kase, id, hour);
      if (r.kind === 'confess') {
        say('npc', `<b>${ch.name}</b>: 나는 ${RKO[r.actualRoom]}에 있었소. ${RKO[r.claimedRoom]}는 못 봤소.`, '실토');
        say('npc', `<b>${ch.name}</b>: ${G.names[r.names]}이 시켰소. ${r.secret?.text || ''}. 그뿐이오.`, '실토');
        say('sys', `증언판: ${ch.name}의 ${hour} 목격은 거짓이었다. 시킨 사람이 있다.`);
        G.broken.add(id); emote(id, 'surprised');
      } else if (r.kind === 'deny') {
        say('npc', `<b>${ch.name}</b>: 나는 ${RKO[r.claimedRoom]}에 있었소. 더 할 말 없소.`, '부인');
        say('sys', `${ch.name}은 부인한다. 실토하지 않는 쪽이 첩자일 수 있다.`);
        emote(id, 'proud');
      } else {
        say('npc', `<b>${ch.name}</b>: ${r.secret?.text || '숨기는 것 없소'}. 문서는 손대지 않았소.`, '비밀');
        emote(id, 'thinking');
      }
      return;
    }

    // 안 가 본 방을 물었나 — 추리의 뼈대
    if (q.room && q.hours.length) {
      const hour = q.hours[0];
      const actual = G.kase.truth[id][hour];
      if (actual !== q.room) {
        say('npc', `<b>${ch.name}</b>: ${D.speakUnknown(q.room).line}`, '결정론');
        addBoard(id, hour, actual, 'self', id);
        emote(id, 'thinking');
        return;
      }
    }

    const hour = q.hours[0] || pickUnaskedHour(id);
    const st = statementOf(G.kase, id, hour);
    const statement = q.asksWho ? st : { ...st, saw: q.asksWhere ? [] : st.saw };
    const res = await D.speak({
      kase: G.kase, character: { id, name: ch.name, persona: ch.persona },
      statement, statements: G.known[id], names: G.names, signature: sig,
      question: text, stance: '',
    });
    say('npc', `<b>${ch.name}</b>: ${res.line}`,
      res.source === 'sam' ? `SAM · 시도${res.tries}` : `결정론${res.reasons.length ? ' · 검증 실패' : ''}`);
    if (res.reasons.length) diag(`${ch.name} 검증 실패:\n  ${res.reasons.join('\n  ')}`);

    G.known[id].push(statement);
    addBoard(id, hour, statement.room, 'self', id);
    for (const w of statement.saw) addBoard(w, hour, statement.room, 'saw', id);
    detectBroken();
    emote(id, statement.lie ? 'surprised' : 'greet');
  } finally {
    finishTurn();
  }
}

function finishTurn() {
  G.busy = false; el('ask').disabled = false;
  G.beats -= 1;

  // 심문 한 번마다 낮이 흐른다 — 인물들이 움직이고 마주친다
  const { hour, met } = advanceBeat(G.world);
  for (const m of met) {
    if (m.ids.length === 2) {
      say('sys', `낮 ${hour} — ${m.ids.map((i) => G.names[i]).join(' · ')}이 ${RKO[m.room]}에 함께 있었다.`);
    }
  }

  renderHUD(); renderBoard(); renderFeed();
  if (G.beats <= 0 && !G.over) { G.over = true; say('sys', '해가 졌다. 이제 지목해야 한다.'); }
  el('ask').focus();
}

// ─────────────────────────────────────────────────────────── 지목
function accuse() {
  if (el('result').textContent) return;
  const pick = { spy: el('accSpy').value, hour: el('accHour').value, witness: el('accWit').value };
  const j = judgeAccusation(G.kase, pick, G.broken);
  G.over = true;
  const k = G.kase;
  const lines = [
    j.win ? '맞혔다.' : '틀렸다.',
    `지목: ${G.names[pick.spy]} · ${pick.hour} · 목격자 ${G.names[pick.witness]}`,
    `진실: 첩자는 ${G.names[k.spy]}, 절도는 ${k.theftHour}, 알리바이로 댄 방은 ${RKO[k.fakeRoom]}.`,
    `공범은 ${G.names[k.accomplice]} — "${k.plant.hour}에 ${RKO[k.plant.room]}에서 ${G.names[k.plant.saw]}를 봤다"고 말하도록 심어졌다.`,
    `그 시각 ${G.names[k.accomplice]}의 실제 위치는 ${RKO[k.plant.actualRoom]}. 여기가 구멍이었다.`,
    G.world.recruitBeat ? `포섭은 낮 ${DAY_HOURS[Math.min(5, Math.floor((G.world.recruitBeat - 1) / 3))]}쯤, 단둘이 있을 때 일어났다.` : '',
    `정직한 목격자: ${k.solution.witness.map((w) => G.names[w]).join(', ') || '없음'}`,
    !j.okWitness ? `목격자 판정: ${j.witnessReason === 'lie-not-broken'
      ? '그는 봤지만 거짓을 말하고 있었다. 먼저 깨야 했다.' : '그는 그 시각 서고에 없었다.'}` : '',
  ].filter(Boolean);
  el('result').className = `result ${j.win ? 'win' : 'lose'}`;
  el('result').innerHTML = lines.map((l) => `<div>${l}</div>`).join('');

  say('sys', '── 진짜 동선 ──');
  for (const id of k.cast) {
    say('sys', `${G.names[id]}: ${HOURS.map((h) => `${h.replace('시', '')}=${RKO[k.truth[id][h]]}`).join(' ')}`);
  }
  diag(`${el('diag').textContent}\n\nSAM 호출 ${D.state.calls}회 · 폴백 ${D.state.fallbacks}회 · 누적 ${D.state.scredits.toFixed(4)} 쌤`);
}

el('askForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = el('ask').value.trim();
  if (!v) return;
  el('ask').value = '';
  ask(v);
});
el('accuseBtn').addEventListener('click', accuse);

boot().catch((err) => {
  document.body.insertAdjacentHTML('afterbegin',
    `<pre style="color:#e88b7f;padding:16px">부팅 실패: ${err.message}\n${err.stack || ''}</pre>`);
});
