/**
 * SAM (SoonSoon AI Management) 최소 클라이언트.
 *
 * 스펙 출처: https://sam.soonsoon.ai/openapi.json (v0.6.0) +
 *            /api-docs 페이지 (ApiDocsPage 청크)
 *
 * 인증: X-API-Key: sam-...   (또는 Authorization: Bearer <id.soonsoon JWT>)
 * 주의: options.stream 의 기본값이 true 다. 한 방에 JSON 을 받고 싶으면
 *       반드시 options.stream: false 를 명시해야 한다.
 */

import { resolveKey } from './keys.mjs';

export const SAM_BASE = process.env.SAM_BASE_URL?.trim() || 'https://sam.soonsoon.ai';

/** 재시도해도 의미 있는 에러 코드 (문서의 Errors & Rate Limits 표 기준) */
const RETRYABLE_CODES = new Set(['RATE_LIMITED', 'PROVIDER_ERROR', 'PROVIDER_UNAVAILABLE']);
/**
 * 게이트웨이/일시 장애는 코드가 아니라 status 로 판단해야 한다.
 * 실측 사례: 신규 계정에서 첫 생성 호출 시 SAM 이
 *   503 {"detail":"Account initialization is temporarily unavailable. Please retry."}
 *   504 Gateway Time-out
 * 을 반환한다. 이때 error.code 가 없어서 코드 기반 판정만으로는 재시도되지 않는다.
 */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

/**
 * SAM 이 계정 프로비저닝을 못 끝냈을 때 반환하는 상태.
 * 실측(2026-08-18): 30초 대기 후 503 {"detail":"Account initialization is
 * temporarily unavailable. Please retry."}. 키·모델·표면(native/openai/anthropic)을
 * 바꿔도 동일하게 재현되므로 클라이언트가 고칠 수 있는 문제가 아니다.
 * 한 번 실패에 30초가 드니 무한 재시도는 해롭다 — 최대 1회만 재시도한다.
 */
export const ACCOUNT_INITIALIZING = 'ACCOUNT_INITIALIZING';
const ACCOUNT_INIT_MAX_RETRIES = 1;

/** 재시도해도 소용없는 것: BUDGET_EXCEEDED(월 예산), KEY_LIMIT_EXCEEDED(키 한도) */
const NON_RETRYABLE_CODES = new Set(['BUDGET_EXCEEDED', 'KEY_LIMIT_EXCEEDED']);

export class SamError extends Error {
  constructor(status, code, message, suggestion = null) {
    super(`SAM ${status} ${code}: ${message}`);
    this.name = 'SamError';
    this.status = status;
    this.code = code;
    this.suggestion = suggestion;
    this.retryable = !NON_RETRYABLE_CODES.has(code)
      && (RETRYABLE_CODES.has(code)
        || RETRYABLE_STATUS.has(Number(status))
        || code === 'CLIENT_TIMEOUT');
  }
}

function apiKey(explicit) {
  // 역할별 키(SAM_KEY_SPUM 등) 선택은 src/keys.mjs 가 담당한다.
  return resolveKey({ key: explicit }).key;
}

async function toSamError(res) {
  let body = null;
  let raw = '';
  try { raw = await res.text(); body = JSON.parse(raw); } catch { /* HTML 504 등 */ }
  const err = body?.error || {};
  const detail = typeof body?.detail === 'string' ? body.detail : '';
  // 긴 detail 문장이 code 자리에 들어가면 로그가 망가진다 — 짧은 코드로 정규화한다.
  let code = err.code || '';
  if (!code && /account initialization/i.test(detail)) code = ACCOUNT_INITIALIZING;
  if (!code) code = detail && detail.length <= 40 ? detail : 'HTTP_ERROR';
  const message = err.message || detail || (raw && !raw.startsWith('<') ? raw.slice(0, 200) : res.statusText);
  return new SamError(res.status, code, message, err.suggestion || null);
}

/** 공통 요청기. 429/5xx 는 suggestion.retry_after_seconds 를 존중해 재시도. */
/** 기본 타임아웃. SAM 의 계정 초기화 실패는 30초 뒤에 오므로 그보다 넉넉히 준다. */
export const DEFAULT_TIMEOUT_MS = Number(process.env.SAM_TIMEOUT_MS || 45000);

function withTimeout(signal, timeoutMs) {
  if (!timeoutMs) return { signal, cleanup: () => {} };
  const timer = AbortSignal.timeout(timeoutMs);
  if (!signal) return { signal: timer, cleanup: () => {} };
  // 호출부 signal 과 타임아웃을 합친다
  const ac = new AbortController();
  const onAbort = (reason) => ac.abort(reason);
  signal.addEventListener('abort', () => onAbort(signal.reason), { once: true });
  timer.addEventListener('abort', () => onAbort(timer.reason), { once: true });
  return { signal: ac.signal, cleanup: () => {} };
}

async function request(path, {
  method = 'POST', body = null, key, retries = 3, signal, onRetry,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  let lastErr = null;
  let accountInitRetries = 0;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const { signal: reqSignal } = withTimeout(signal, timeoutMs);
    let res;
    try {
      res = await fetch(`${SAM_BASE}${path}`, {
        method,
        headers: {
          'X-API-Key': apiKey(key),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: reqSignal,
      });
    } catch (err) {
      // AbortError = 타임아웃. 재시도 대상으로 취급한다.
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      lastErr = timedOut
        ? new SamError(0, 'CLIENT_TIMEOUT', `${timeoutMs}ms 안에 응답이 없었습니다`)
        : err;
      if (!timedOut || attempt === retries) throw lastErr;
      onRetry?.({ attempt: attempt + 1, retries, waitSec: 1, error: lastErr });
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    if (res.ok) return res;
    const err = await toSamError(res);
    lastErr = err;
    // 계정 초기화 실패는 한 번만 더 시도한다 (매 시도에 30초가 든다)
    if (err.code === ACCOUNT_INITIALIZING) {
      accountInitRetries += 1;
      if (accountInitRetries > ACCOUNT_INIT_MAX_RETRIES) throw err;
    }
    if (!err.retryable || attempt === retries) throw err;
    // retry_after_seconds 가 오면 그대로 존중하고, 없으면 1s/2s/4s… 지수 백오프 (최대 20s)
    const hinted = Number(err.suggestion?.retry_after_seconds);
    const waitSec = Number.isFinite(hinted) && hinted > 0 ? hinted : Math.min(20, 2 ** attempt);
    onRetry?.({ attempt: attempt + 1, retries, waitSec, error: err });
    await new Promise((r) => setTimeout(r, waitSec * 1000));
  }
  throw lastErr;
}

/**
 * POST /v1/generate — 논스트리밍. 텍스트를 문자열로 돌려준다.
 * @returns {{ text: string, toolCalls: any[]|null, images: any[]|null, usage: object, meta: object, requestId: string }}
 */
export async function generate({ model, messages, task, tools, toolChoice, options = {}, fallback, key, signal, retries, onRetry, timeoutMs } = {}) {
  const res = await request('/v1/generate', {
    key,
    signal,
    ...(retries !== undefined ? { retries } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    onRetry,
    body: {
      model,
      ...(task ? { task } : {}),
      messages,
      ...(tools ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      ...(fallback ? { fallback } : {}),
      options: { stream: false, ...options },
    },
  });
  const json = await res.json();
  return {
    text: extractText(json),
    toolCalls: json?.output?.tool_calls ?? null,
    images: json?.output?.images ?? null,
    thinking: json?.output?.thinking ?? null,
    usage: json?.usage ?? {},
    meta: json?.meta ?? {},
    requestId: json?.request_id ?? '',
  };
}

/**
 * 구조화 JSON 을 강제로 받는다. options.json_schema 를 쓰고, 그래도 모델이
 * 코드펜스를 붙이는 경우가 있어 파싱을 방어적으로 한다.
 */
export async function generateJson({ jsonSchema, ...rest }) {
  const result = await generate({
    ...rest,
    options: { ...(rest.options || {}), ...(jsonSchema ? { json_schema: jsonSchema } : {}) },
  });
  return { ...result, data: parseJsonLoose(result.text) };
}

/** POST /v1/generate 스트리밍 — SSE 이벤트를 async iterator 로 흘린다. */
export async function* generateStream({ model, messages, options = {}, key, signal, retries = 3, onRetry, timeoutMs } = {}) {
  const res = await request('/v1/generate', {
    key,
    signal,
    retries,
    onRetry,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    body: { model, messages, options: { stream: true, ...options } },
  });
  yield* parseSse(res.body);
}

/** POST /v1/image/generate */
export async function generateImage({ model, prompt, size = '1024x1024', quality = 'low', n = 1, key, signal } = {}) {
  const res = await request('/v1/image/generate', {
    key, signal,
    body: { model, prompt, size, quality, n, stream: false },
  });
  return res.json();
}

/** GET /v1/models — 인증 없이도 열려 있지만 키를 붙여도 무해하다. */
export async function listModels({ key } = {}) {
  const res = await fetch(`${SAM_BASE}/v1/models`, {
    headers: key || process.env.SAM_API_KEY ? { 'X-API-Key': apiKey(key) } : {},
  });
  if (!res.ok) throw await toSamError(res);
  return res.json();
}

/** GET /v1/account — 키 유효성과 쌤(SCredit) 잔액 확인용. */
export async function getAccount({ key, retries = 3, onRetry, timeoutMs } = {}) {
  const res = await request('/v1/account', { method: 'GET', key, retries, onRetry, ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
  return res.json();
}

// ---------------------------------------------------------------- helpers

/**
 * SAM 응답에서 텍스트를 뽑는다. output.content 가 문자열인 경우가 표준이지만
 * 배열/객체로 오는 provider 도 있어 SPUM 런타임과 같은 방식으로 관용 처리한다.
 */
export function extractText(json = {}) {
  const content = json?.output?.content ?? json?.content ?? json?.text ?? '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((item) => (
      typeof item === 'string' ? item : item?.text || item?.content || item?.value || ''
    )).join('');
  }
  if (content && typeof content === 'object') {
    return content.text || content.content || content.value || '';
  }
  return '';
}

/** 코드펜스·앞뒤 잡담이 섞인 응답에서 최외곽 JSON 객체를 건져낸다. */
export function parseJsonLoose(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const candidates = [];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  candidates.push(raw);
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* 다음 후보 */ }
  }
  return null;
}

/** ReadableStream(SSE) → {type,...} 이벤트 async generator */
export async function* parseSse(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SAM 은 이벤트를 개행으로 구분한다. \n\n 만 기다리면 멈추는 경우가 있어
      // SPUM 런타임과 동일하게 줄 단위로 처리한다.
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === '[DONE]') continue;
        try { yield JSON.parse(payload); } catch { /* 조각난 JSON 무시 */ }
      }
    }
  } finally {
    reader.releaseLock?.();
  }
}
