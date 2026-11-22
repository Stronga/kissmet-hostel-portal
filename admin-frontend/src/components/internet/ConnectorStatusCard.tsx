import { RefreshCw, Wifi } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getConnectorHealth, getConnectorStatus } from "../../api/internetAccess";
import { useAuth } from "../../auth/AuthContext";
import { hasPermission } from "../../auth/permissions";
import type { ConnectorHealth, ConnectorStatus } from "../../types/api";
import { formatDateTime } from "../../utils/format";
import { connectorPresence, formatAge, presenceLabel, primaryConnector } from "./connectorStatus";

const LIVE_PROBE_COOLDOWN_MS = 15_000;

const presenceTone: Record<string, string> = {
  online: "text-emerald-700",
  stale: "text-amber-700",
  offline: "text-red-700"
};

const presenceDot: Record<string, string> = {
  online: "bg-emerald-600",
  stale: "bg-amber-500",
  offline: "bg-red-600"
};

export function ConnectorStatusCard({ showLiveProbe = false }: { showLiveProbe?: boolean }) {
  const { user, isLoading: authLoading } = useAuth();
  const canRead = hasPermission(user?.role, "internet:read");
  const [status, setStatus] = useState<ConnectorStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<ConnectorHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await getConnectorStatus());
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Unable to load connector status.");
    } finally {
      setLoading(false);
    }
  }, []);

  const probe = useCallback(async () => {
    if (Date.now() < cooldownUntil) return;
    setProbing(true);
    setHealthError(null);
    try {
      setHealth(await getConnectorHealth());
    } catch (err) {
      setHealth(null);
      setHealthError(err instanceof Error ? err.message : "Unable to check connector health.");
    } finally {
      setProbing(false);
      setCooldownUntil(Date.now() + LIVE_PROBE_COOLDOWN_MS);
    }
  }, [cooldownUntil]);

  useEffect(() => {
    if (authLoading || !canRead) return;
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [authLoading, canRead, load]);

  if (authLoading || !canRead) return null;

  const connector = primaryConnector(status);
  const presence = connector
    ? connectorPresence(connector.ageSeconds, status?.staleAfterSeconds ?? 180)
    : "offline";

  return (
    <section className="rounded-token border border-border bg-surface p-4" aria-labelledby="connector-status-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Wifi className={`mt-0.5 h-4 w-4 ${presenceTone[presence]}`} aria-hidden />
          <div>
            <h2 id="connector-status-heading" className="text-sm font-semibold text-text-primary">Connector status</h2>
            {loading && !status && !error ? (
              <p className="mt-1 text-xs text-text-secondary">Loading heartbeat…</p>
            ) : error ? (
              <p className="mt-1 text-xs text-danger" role="alert">{error}</p>
            ) : !status?.configured ? (
              <p className="mt-1 text-xs text-text-secondary">Heartbeat is not configured in this environment.</p>
            ) : !connector ? (
              <p className="mt-1 text-sm font-medium text-red-700">
                <span className={`mr-2 inline-block h-2 w-2 rounded-full ${presenceDot.offline}`} aria-hidden />
                Offline · Waiting for the first heartbeat
              </p>
            ) : (
              <p className={`mt-1 text-sm font-medium ${presenceTone[presence]}`}>
                <span className={`mr-2 inline-block h-2 w-2 rounded-full ${presenceDot[presence]}`} aria-hidden />
                {presenceLabel(presence)}
                <span className="ml-2 font-normal text-text-secondary">Last seen {formatAge(connector.ageSeconds)}</span>
              </p>
            )}
          </div>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm font-medium">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {status && !error ? (
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Configured</dt>
            <dd className="mt-1 font-medium text-text-primary">{status.configured ? "Yes" : "No"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Version</dt>
            <dd className="mt-1 font-medium text-text-primary">{connector?.version ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-text-secondary">RouterOS</dt>
            <dd className="mt-1 font-medium text-text-primary">{connector?.routerosStatus ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Last seen</dt>
            <dd className="mt-1 font-medium text-text-primary">{connector ? formatDateTime(connector.lastSeenAt) : "Never"}</dd>
          </div>
        </dl>
      ) : null}

      {showLiveProbe ? (
        <div className="mt-4 border-t border-border pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-text-secondary">
              {healthError
                ? healthError
                : health
                  ? health.ok
                    ? `Live probe reachable${health.board ? ` · ${health.board}` : ""}${health.version ? ` · ${health.version}` : ""}`
                    : health.message || "Live probe unavailable"
                  : "Live probe has not been run in this session."}
            </p>
            <button
              type="button"
              onClick={() => void probe()}
              disabled={probing || Date.now() < cooldownUntil}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              {probing ? "Probing…" : "Run live probe"}
            </button>
          </div>
          <p className="mt-2 text-xs text-text-secondary">The live probe is rate-limited to once every 15 seconds. Connector URLs and secrets are never shown.</p>
        </div>
      ) : null}
    </section>
  );
}
