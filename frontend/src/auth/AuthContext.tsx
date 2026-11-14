import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { setUnauthorizedHandler } from '../api/client';
import { endpoints } from '../api/endpoints';
import { clearPreservingInstance, markInstanceSetUp } from '../api/queries';
import type { LoginRequest, LoginResponse, Role, SetupRequest, User } from '../api/types';
import { can as canRole, type Permission } from './permissions';
import { clearSession, loadSession, saveSession, saveUser } from './storage';

interface AuthValue {
  user: User | null;
  role: Role | null;
  isAuthenticated: boolean;
  /** True when the last logout was forced by a 401 (session expired). */
  sessionExpired: boolean;
  login: (credentials: LoginRequest) => Promise<User>;
  /** First-run setup: creates the first Owner and starts its session. */
  setup: (input: SetupRequest) => Promise<User>;
  logout: () => void;
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(() => loadSession()?.user ?? null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    clearPreservingInstance(queryClient);
  }, [queryClient]);

  // Any 401 from an authenticated call logs the user out; the route guard sends them to /login.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setSessionExpired(true);
      setUser(null);
      clearPreservingInstance(queryClient);
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  // Refresh the profile (role may have changed) when restoring a stored session.
  const hasUser = user !== null;
  useEffect(() => {
    if (!hasUser) return;
    const controller = new AbortController();
    endpoints
      .me(controller.signal)
      .then((fresh) => {
        saveUser(fresh);
        setUser(fresh);
      })
      .catch(() => {
        // 401 is handled globally; other errors keep the cached profile.
      });
    return () => controller.abort();
  }, [hasUser]);

  const startSession = useCallback(
    (res: LoginResponse) => {
      saveSession({ token: res.token, user: res.user, expiresAt: res.expiresAt });
      clearPreservingInstance(queryClient);
      setSessionExpired(false);
      setUser(res.user);
      return res.user;
    },
    [queryClient],
  );

  const login = useCallback(
    async (credentials: LoginRequest) => startSession(await endpoints.login(credentials)),
    [startSession],
  );

  const setup = useCallback(
    async (input: SetupRequest) => {
      const res = await endpoints.setup(input);
      const created = startSession(res);
      markInstanceSetUp(queryClient, input.organizationName);
      return created;
    },
    [startSession, queryClient],
  );

  const value = useMemo<AuthValue>(
    () => ({
      user,
      role: user?.role ?? null,
      isAuthenticated: user !== null,
      sessionExpired,
      login,
      setup,
      logout,
      can: (permission) => canRole(user?.role, permission),
    }),
    [user, sessionExpired, login, setup, logout],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
