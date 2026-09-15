import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchResidentInternetAccess,
  fetchResidentInternetSessions,
  type ResidentInternetAccess,
  type ResidentInternetSessions
} from "../api/internetAccess";

/** Preferred auto-refresh while the Internet Access card is mounted (≥60s). */
export const INTERNET_SESSIONS_AUTO_REFRESH_MS = 60_000;

export function useResidentInternetAccess() {
  const [account, setAccount] = useState<ResidentInternetAccess | null>(null);
  const [sessions, setSessions] = useState<ResidentInternetSessions | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const sessionsInFlight = useRef(false);
  const mounted = useRef(true);

  const loadAccount = useCallback(async () => {
    setAccountLoading(true);
    setAccountError(null);
    try {
      const response = await fetchResidentInternetAccess();
      if (!mounted.current) return;
      setAccount(response.data);
    } catch (error) {
      if (!mounted.current) return;
      setAccount(null);
      setAccountError(error instanceof Error ? error.message : "Unable to load internet access.");
    } finally {
      if (mounted.current) setAccountLoading(false);
    }
  }, []);

  const loadSessions = useCallback(async (opts?: { manual?: boolean }) => {
    if (sessionsInFlight.current) return;
    sessionsInFlight.current = true;
    if (opts?.manual) setRefreshing(true);
    else setSessionsLoading(true);
    try {
      const response = await fetchResidentInternetSessions();
      if (!mounted.current) return;
      setSessions(response.data);
    } catch {
      if (!mounted.current) return;
      // Keep D1 account state; live count is independently unavailable.
      setSessions({ activeCount: null, deviceLimit: account?.deviceLimit ?? 3 });
    } finally {
      sessionsInFlight.current = false;
      if (mounted.current) {
        setSessionsLoading(false);
        setRefreshing(false);
      }
    }
  }, [account?.deviceLimit]);

  useEffect(() => {
    mounted.current = true;
    void loadAccount();
    return () => {
      mounted.current = false;
    };
  }, [loadAccount]);

  const shouldPollSessions =
    Boolean(account?.hasAccess) &&
    account?.status === "active" &&
    account?.syncStatus === "synced";

  useEffect(() => {
    if (!shouldPollSessions) {
      setSessions(null);
      return;
    }
    void loadSessions();
    const timer = window.setInterval(() => {
      void loadSessions();
    }, INTERNET_SESSIONS_AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [shouldPollSessions, loadSessions]);

  const refreshSessions = useCallback(() => {
    if (!shouldPollSessions || sessionsInFlight.current) return;
    void loadSessions({ manual: true });
  }, [shouldPollSessions, loadSessions]);

  return {
    account,
    sessions,
    accountLoading,
    accountError,
    sessionsLoading,
    refreshing,
    retryAccount: loadAccount,
    refreshSessions,
    canRefreshSessions: shouldPollSessions
  };
}
