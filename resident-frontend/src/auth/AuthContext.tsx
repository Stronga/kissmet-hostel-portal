import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchMe, logout as logoutRequest } from "../api/auth";
import { onUnauthorized, setAuthToken } from "../api/client";
import type { AuthUser } from "../types/api";

export const RESIDENT_TOKEN_KEY = "kissmet_resident_token";

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  restoreSession: () => Promise<void>;
  acceptSessionToken: (token: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(RESIDENT_TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const clearSession = useCallback(() => {
    localStorage.removeItem(RESIDENT_TOKEN_KEY);
    setAuthToken(null);
    setToken(null);
    setUser(null);
  }, []);

  const requireResidentUser = useCallback((currentUser: AuthUser) => {
    if (currentUser.userType !== "resident" || currentUser.role !== "resident" || !currentUser.residentId) {
      throw new Error("This portal is only available to resident accounts.");
    }
    return currentUser;
  }, []);

  const restoreSession = useCallback(async () => {
    const storedToken = localStorage.getItem(RESIDENT_TOKEN_KEY);
    if (!storedToken) {
      clearSession();
      setIsLoading(false);
      return;
    }
    setAuthToken(storedToken);
    setToken(storedToken);
    try {
      const current = await fetchMe();
      setUser(requireResidentUser(current.user));
    } catch {
      clearSession();
    } finally {
      setIsLoading(false);
    }
  }, [clearSession, requireResidentUser]);

  const acceptSessionToken = useCallback(async (nextToken: string) => {
    localStorage.setItem(RESIDENT_TOKEN_KEY, nextToken);
    setAuthToken(nextToken);
    setToken(nextToken);
    const current = await fetchMe();
    setUser(requireResidentUser(current.user));
  }, [requireResidentUser]);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      clearSession();
    }
  }, [clearSession]);

  useEffect(() => {
    onUnauthorized(clearSession);
    return () => onUnauthorized(null);
  }, [clearSession]);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  const value = useMemo(
    () => ({ token, user, isAuthenticated: Boolean(user), isLoading, restoreSession, acceptSessionToken, logout }),
    [token, user, isLoading, restoreSession, acceptSessionToken, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
