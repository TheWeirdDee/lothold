let csrf: string | null = null;
export function setCsrf(t: string | null) {
  csrf = t;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** True when an /api request was answered by something other than the LotHold server (e.g. a static host's 404 page). */
export const isBackendUnavailable = (e: unknown) => e instanceof ApiError && (e.code === 'backend_unavailable' || e.code === 'network' || e.code === 'timeout' || e.code === 'backend_starting');

/** Fired when the backend looks like it is starting (cold start on free hosting): gateway errors or timeouts. */
export const WAKING_EVENT = 'lothold:backend-starting';
export const READY_EVENT = 'lothold:backend-ready';
const signalStarting = () => { try { window.dispatchEvent(new Event(WAKING_EVENT)); } catch { /* not in a browser */ } };

// Timeouts: uploads and model extraction can legitimately take longer than ordinary requests.
const timeoutFor = (path: string, body: unknown) => (body instanceof FormData ? 180_000 : /\/extract$/.test(path) ? 150_000 : /forest-check|\/documents\//.test(path) ? 90_000 : 45_000);

export async function api<T = any>(method: string, path: string, body?: unknown, opts: { timeoutMs?: number } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', signal: AbortSignal.timeout(opts.timeoutMs ?? timeoutFor(path, body)) });
  } catch (e) {
    if ((e as Error).name === 'TimeoutError') {
      signalStarting();
      throw new ApiError(0, 'timeout', 'The server did not respond in time. The outcome may be uncertain. Keep your form entries and check the current record before retrying.');
    }
    throw new ApiError(0, 'network', 'The server could not be reached. Check your connection and try again.');
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  // The LotHold API always answers in JSON; anything else means this site is not connected to it.
  // Gateway errors while a sleeping free server wakes up: "starting", not "missing".
  if (path.startsWith('/api/') && json === null && [502, 503, 504].includes(res.status)) {
    signalStarting();
    throw new ApiError(res.status, 'backend_starting', 'The LotHold server is starting up. Your form entries remain here while readiness is checked.');
  }
  if (path.startsWith('/api/') && json === null && !(res.ok && text === ''))
    throw new ApiError(res.status, 'backend_unavailable', 'The LotHold server is not available at this address, so this page cannot load its data.');
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? `Request failed (${res.status}).`);
  return json as T;
}

/** Requests a short-lived signed URL and starts the download. */
export async function download(linkEndpoint: string) {
  const r = await api<{ url: string }>('POST', linkEndpoint);
  const a = document.createElement('a');
  a.href = r.url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const fmtDate = (iso: string | null | undefined) => (iso ? `${iso.replace('T', ' ').slice(0, 16)} UTC` : '—');
export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
