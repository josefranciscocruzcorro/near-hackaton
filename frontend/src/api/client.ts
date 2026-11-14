import { clearSession, getToken } from '../auth/storage';
import type { ProblemDetails } from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails | null;

  constructor(status: number, problem: ProblemDetails | null, fallback: string) {
    super(problem?.detail ?? problem?.title ?? fallback);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }

  /** Field-level validation errors keyed by camelCase field name (lowercased first char). */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    const errors = this.problem?.errors;
    if (!errors) return out;
    for (const [key, messages] of Object.entries(errors)) {
      const first = messages[0];
      if (first === undefined) continue;
      const field = key.length > 0 ? key.charAt(0).toLowerCase() + key.slice(1) : key;
      out[field] = first;
    }
    return out;
  }
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Registers the callback fired when an authenticated request gets 401 (session expired/invalid). */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

let requestLanguage: string | null = null;

/** UI language sent as `Accept-Language` on every request (the agent answers in it). */
export function setRequestLanguage(lang: string | null): void {
  requestLanguage = lang;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** When false the request is sent without the bearer token and a 401 does not log out (login). */
  auth?: boolean;
}

async function readProblem(res: Response): Promise<ProblemDetails | null> {
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) return null;
  try {
    return (await res.json()) as ProblemDetails;
  } catch {
    return null;
  }
}

/** Low-level fetch that adds auth, handles 401 globally and throws ApiError on non-2xx. */
export async function apiRequest(path: string, options: RequestOptions = {}): Promise<Response> {
  const { method = 'GET', body, signal, auth = true } = options;
  const headers = new Headers({ Accept: 'application/json' });
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (requestLanguage) headers.set('Accept-Language', requestLanguage);
  const token = auth ? getToken() : null;
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    // Absolute URL: same-origin in the browser, and resolvable under jsdom/Node fetch in tests.
    res = await fetch(new URL(path, window.location.origin), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, null, 'Network error — check your connection.');
  }

  if (res.status === 401 && auth) {
    clearSession();
    unauthorizedHandler?.();
    throw new ApiError(401, await readProblem(res), 'Your session has expired. Please sign in again.');
  }
  if (!res.ok) {
    throw new ApiError(res.status, await readProblem(res), `Request failed (${res.status}).`);
  }
  return res;
}

/** JSON request helper. Returns undefined for 204 responses. */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await apiRequest(path, options);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
