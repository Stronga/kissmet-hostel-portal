import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchMe, logout as logoutRequest, staffLogin } from "../api/auth";
import { onUnauthorized, setAuthToken } from "../api/client";
import type { AuthUser } from "../types/api";

const TOKEN_KEY = "kissmet_admin_token";

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isLoading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const clearSession = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setAuthToken(null);
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    onUnauthorized(clearSession);
    return () => onUnauthorized(null);
  }, [clearSession]);

  useEffect(() => {
    async function restoreSession() {
      if (!token) {
        setIsLoading(false);
        return;
      }
      setAuthToken(token);
      try {
        const current = await fetchMe();
        setUser(current.user);
      } catch {
        clearSession();
      } finally {
        setIsLoading(false);
      }
    }
    void restoreSession();
  }, [clearSession, token]);

  const login = useCallback(async (identifier: string, password: string) => {
    const result = await staffLogin(identifier, password);
    localStorage.setItem(TOKEN_KEY, result.token);
    setAuthToken(result.token);
    setToken(result.token);
    const current = await fetchMe();
    setUser(current.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo(() => ({ token, user, isLoading, login, logout }), [token, user, isLoading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
