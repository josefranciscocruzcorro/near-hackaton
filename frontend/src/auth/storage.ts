import type { User } from '../api/types';

const TOKEN_KEY = 'tesorero.token';
const USER_KEY = 'tesorero.user';
const EXPIRES_KEY = 'tesorero.expiresAt';

export interface StoredSession {
  token: string;
  user: User;
  expiresAt: string | null;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return safeGet(TOKEN_KEY);
}

export function loadSession(now: number = Date.now()): StoredSession | null {
  const token = safeGet(TOKEN_KEY);
  const rawUser = safeGet(USER_KEY);
  if (!token || !rawUser) return null;
  const expiresAt = safeGet(EXPIRES_KEY);
  if (expiresAt && Date.parse(expiresAt) <= now) {
    clearSession();
    return null;
  }
  try {
    const user = JSON.parse(rawUser) as User;
    return { token, user, expiresAt };
  } catch {
    clearSession();
    return null;
  }
}

export function saveSession(session: StoredSession): void {
  try {
    localStorage.setItem(TOKEN_KEY, session.token);
    localStorage.setItem(USER_KEY, JSON.stringify(session.user));
    if (session.expiresAt) localStorage.setItem(EXPIRES_KEY, session.expiresAt);
    else localStorage.removeItem(EXPIRES_KEY);
  } catch {
    // Storage unavailable (private mode); the session lives only in memory.
  }
}

export function saveUser(user: User): void {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // ignore
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(EXPIRES_KEY);
  } catch {
    // ignore
  }
}
