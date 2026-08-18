/**
 * SAM 프록시 — SPUM 월드 런타임이 그대로 물려 쓸 수 있는 same-origin 엔드포인트.
 *
 * 왜 프록시가 필요한가:
 *   1) API 키가 브라우저에 절대 내려가면 안 된다. SPUM 도 같은 결론에 도달했다 —
 *      studio/ai/AgentSettings.js 는 이제 localStorage 의 apiKey 를 읽는 즉시
 *      지워버리고 getStudioApiKey() 가 빈 문자열을 반환한다 (과거 키 유출 흔적으로
 *      LEAKED_SAM_KEY_PREFIXES 상수가 남아 있다).
 *   2) SPUM 런타임은 모델을 'light'/'medium'/'expert' 로만 보낸다. 실제 SAM alias 가
 *      아니므로 누군가는 변환해야 한다. spum.soonsoon.ai 에서는 그쪽 /api/sam 이
 *      해준다. 우리가 호스팅하면 우리가 해야 한다.
 *
 * 경로는 SPUM 런타임의 기본값과 정확히 일치시킨다:
 *   POST /api/sam/v1/generate      (WorldLLMRuntimeTransport.js, WorldMissionManager.js)
 * 그 외 /api/sam/* 는 SAM 으로 그대로 통과시킨다.
 *
 * 실행: node server/sam-proxy.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { SAM_BASE } from '../src/sam.mjs';
import { maskKey, resolveKey } from '../src/keys.mjs';
import { describeResolution, resolveModel } from '../src/tiers.mjs';

const PORT = Number(process.env.PORT || 8787);
/**
 * 기본은 루프백만 듣는다.
 * listen(PORT) 로 두면 0.0.0.0 에 붙어 LAN 의 아무나 /api/sam 을 호출할 수 있고,
 * 그건 곧 남이 내 SAM 키로 쌤을 태운다는 뜻이다. Windows 브라우저에서
 * localhost:8787 로 접근하는 데는 루프백만으로 충분하다 (WSL2 가 포워딩한다).
 * 밖에 노출해야 한다면 HOST=0.0.0.0 과 SPUM_WORLD_ACCESS_TOKEN 을 함께 지정한다.
 */
const HOST = process.env.HOST || '127.0.0.1';
const PRESET = process.env.SAM_TIER_PRESET || 'balanced';
const WEB_ROOT = new URL('../web/', import.meta.url).pathname;
/** 브라우저에서 붙는 오리진 허용 목록. Studio 콘솔에서 쓰려면 spum 오리진이 필요. */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS
  || 'https://spum.soonsoon.ai,http://localhost:8787,http://127.0.0.1:8787')
  .split(',').map((s) => s.trim()).filter(Boolean);
/** 프록시 자체를 보호하는 공유 비밀. SPUM 런타임이 X-SPUM-WORLD-ACCESS 로 보낸다. */
const ACCESS_TOKEN = String(process.env.SPUM_WORLD_ACCESS_TOKEN || '').trim();

let KEY = '';
let KEY_ROLE = '';
try {
  const resolved = resolveKey();
  KEY = resolved.key;
  KEY_ROLE = resolved.role;
} catch (err) {
  console.error(`[sam-proxy] ${err.message}`);
  console.error('[sam-proxy] `pnpm proxy` 로 실행하면 .env 와 .env.local 을 자동으로 읽습니다.');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

let requestCount = 0;
let screditTotal = 0;
/** 정적 파일 접근 기록 — 브라우저가 실제로 받아갔는지 확인할 수단이 필요하다.
 *  캔버스 게임은 자산 하나가 404 나면 화면만 비고 원인이 안 보인다. */
const staticHits = new Map();
const staticMisses = new Map();

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-SPUM-WORLD-ACCESS,X-API-Key');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

/** SPUM 티어 이름을 실제 alias 로 바꾼다. body 는 그 외 건드리지 않는다. */
function rewriteModel(bodyBuf) {
  if (!bodyBuf?.length) return { buf: bodyBuf, note: '(empty body)' };
  let parsed;
  try { parsed = JSON.parse(bodyBuf.toString('utf8')); } catch { return { buf: bodyBuf, note: '(non-json body, passthrough)' }; }
  if (!parsed || typeof parsed !== 'object') return { buf: bodyBuf, note: '(non-object body)' };
  const note = describeResolution(parsed.model, PRESET);
  parsed.model = resolveModel(parsed.model, PRESET);
  // fallback 배열도 같은 변환을 적용해야 폴백이 404 로 죽지 않는다.
  if (Array.isArray(parsed.fallback)) parsed.fallback = parsed.fallback.map((m) => resolveModel(m, PRESET));
  return { buf: Buffer.from(JSON.stringify(parsed)), note };
}

async function proxySam(req, res, samPath, bodyBuf) {
  const { buf, note } = rewriteModel(bodyBuf);
  const id = ++requestCount;
  const started = Date.now();
  const upstream = await fetch(`${SAM_BASE}${samPath}`, {
    method: req.method,
    headers: {
      'X-API-Key': KEY,
      ...(buf?.length ? { 'Content-Type': 'application/json' } : {}),
    },
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : (buf?.length ? buf : undefined),
  });

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  const passHeaders = { 'Content-Type': contentType };
  // 레이트리밋 헤더는 클라이언트가 보면 유용하므로 그대로 넘긴다.
  for (const h of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-key-limit', 'x-ratelimit-key-remaining']) {
    const v = upstream.headers.get(h);
    if (v) passHeaders[h] = v;
  }
  cors(req, res);

  // SSE: 그대로 흘려보낸다. 버퍼링하면 스트리밍의 의미가 사라진다.
  if (contentType.includes('text/event-stream')) {
    res.writeHead(upstream.status, { ...passHeaders, 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
    console.log(`[${id}] ${req.method} ${samPath} model=${note} sse ${upstream.status} ${Date.now() - started}ms`);
    return;
  }

  const text = await upstream.text();
  // 비용 가시화 — 게임은 호출 수가 폭발하기 쉬우므로 누적 쌤을 계속 보여준다.
  let scredits = null;
  try {
    const parsed = JSON.parse(text);
    scredits = parsed?.usage?.scredits ?? null;
    if (typeof scredits === 'number') screditTotal += scredits;
  } catch { /* JSON 아니면 무시 */ }
  res.writeHead(upstream.status, { ...passHeaders, 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
  console.log(
    `[${id}] ${req.method} ${samPath} model=${note} ${upstream.status} ${Date.now() - started}ms`
    + (scredits != null ? ` scredits=${scredits} (누적 ${screditTotal.toFixed(4)})` : ''),
  );
}

function noteStatic(map, key) { map.set(key, (map.get(key) || 0) + 1); }

async function serveStatic(req, res, pathname) {
  // 디렉토리로 끝나면 index.html 을 찾는다 (/game/ -> /game/index.html)
  const wanted = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const rel = wanted === '/index.html' ? 'index.html' : wanted.replace(/^\/+/, '');
  const file = join(WEB_ROOT, normalize(rel));
  if (!file.startsWith(WEB_ROOT)) return json(res, 403, { error: 'forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
    noteStatic(staticHits, pathname);
  } catch {
    json(res, 404, { error: 'not found', path: pathname });
    noteStatic(staticMisses, pathname);
    console.log(`[static] \x1b[31m404\x1b[0m ${pathname}`);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  if (req.method === 'OPTIONS') { cors(req, res); res.writeHead(204); return res.end(); }

  if (pathname === '/healthz') {
    cors(req, res);
    return json(res, 200, {
      ok: true, preset: PRESET, requests: requestCount, screditTotal,
      accessTokenRequired: Boolean(ACCESS_TOKEN),
      static: { served: [...staticHits.values()].reduce((a, b) => a + b, 0), missing: [...staticMisses.keys()] },
    });
  }

  if (pathname === '/_hits') {
    cors(req, res);
    return json(res, 200, {
      served: Object.fromEntries([...staticHits.entries()].sort((a, b) => b[1] - a[1])),
      missing: Object.fromEntries(staticMisses.entries()),
    });
  }

  if (pathname.startsWith('/api/sam/')) {
    if (ACCESS_TOKEN && req.headers['x-spum-world-access'] !== ACCESS_TOKEN) {
      cors(req, res);
      return json(res, 401, { ok: false, error: { code: 'PROXY_ACCESS_DENIED', message: 'X-SPUM-WORLD-ACCESS 헤더가 필요합니다.' } });
    }
    const samPath = pathname.slice('/api/sam'.length) + (url.search || '');
    try {
      const body = await readBody(req);
      return await proxySam(req, res, samPath, body);
    } catch (err) {
      cors(req, res);
      return json(res, 502, { ok: false, error: { code: 'PROXY_ERROR', message: String(err?.message || err) } });
    }
  }

  return serveStatic(req, res, pathname);
});

if (HOST === '0.0.0.0' && !ACCESS_TOKEN) {
  console.error('[sam-proxy] HOST=0.0.0.0 인데 SPUM_WORLD_ACCESS_TOKEN 이 없습니다.');
  console.error('[sam-proxy] 그대로 열면 같은 네트워크의 누구나 이 키로 SAM 을 호출할 수 있습니다. 중단합니다.');
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  console.log(`[sam-proxy] http://localhost:${PORT}  (bind ${HOST})`);
  console.log(`[sam-proxy] SPUM 런타임용 엔드포인트: http://localhost:${PORT}/api/sam/v1/generate`);
  console.log(`[sam-proxy] 사용 키: ${KEY_ROLE} ${maskKey(KEY)}`);
  console.log(`[sam-proxy] 티어 프리셋: ${PRESET} — light/medium/expert 를 실제 alias 로 변환`);
  console.log(`[sam-proxy] 허용 오리진: ${ALLOWED_ORIGINS.join(', ')}`);
  if (!ACCESS_TOKEN) console.log('[sam-proxy] 경고: SPUM_WORLD_ACCESS_TOKEN 미설정 — 로컬 전용으로만 쓰세요.');
});
