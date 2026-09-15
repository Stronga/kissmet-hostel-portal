import { RefreshCw, Wifi } from "lucide-react";
import { Card } from "../../components/common/Card";
import { ErrorState } from "../../components/common/ErrorState";
import { LoadingState } from "../../components/common/LoadingState";
import { useResidentInternetAccess } from "../../hooks/useResidentInternetAccess";

function statusLabel(status: string | null | undefined) {
  if (!status) return "Unknown";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusTone(status: string | null | undefined) {
  if (status === "active") return "bg-[#dcf1e9] text-[#127b55]";
  if (status === "suspended" || status === "disabled") return "bg-red-50 text-danger";
  if (status === "pending" || status === "failed") return "bg-[#e6f2fb] text-[#1974d2]";
  return "bg-muted text-text-secondary";
}

function ConnectionInstructions() {
  return (
    <div className="mt-4 rounded-xl border border-border bg-[#f7f9fa] px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">How to connect</p>
      <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-[13px] leading-snug text-text-secondary">
        <li>Connect your device to the hostel Wi-Fi.</li>
        <li>Open the sign-in page when prompted.</li>
        <li>Enter your Internet ID and internet password.</li>
        <li>You can use up to 3 devices at the same time.</li>
      </ol>
      <p className="mt-3 text-[12px] leading-snug text-text-secondary">
        If you lost your internet password, contact hostel management. Kissmet portal login and OTP codes are not your Wi-Fi password.
      </p>
    </div>
  );
}

export function InternetAccessCard() {
  const {
    account,
    sessions,
    accountLoading,
    accountError,
    sessionsLoading,
    refreshing,
    retryAccount,
    refreshSessions,
    canRefreshSessions
  } = useResidentInternetAccess();

  if (accountLoading) {
    return (
      <Card className="!rounded-3xl border-[#eaeff2] !p-6 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
        <LoadingState label="Loading internet access" />
      </Card>
    );
  }

  if (accountError || !account) {
    return (
      <Card className="!rounded-3xl border-[#eaeff2] !p-6 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
        <ErrorState
          title="Internet access unavailable"
          message={accountError ?? "Unable to load internet access."}
          onRetry={() => void retryAccount()}
        />
      </Card>
    );
  }

  const suspended =
    account.hasAccess &&
    (account.status === "suspended" || account.status === "disabled");

  const setupUpdating =
    account.hasAccess &&
    !suspended &&
    (account.syncStatus === "pending" || account.syncStatus === "failed");

  const active =
    account.hasAccess &&
    account.status === "active" &&
    account.syncStatus === "synced";

  const activeCount = sessions?.activeCount ?? null;
  const deviceLimit = account.deviceLimit || 3;
  const atLimit = activeCount !== null && activeCount >= deviceLimit;

  return (
    <Card className="!rounded-3xl border-[#eaeff2] !p-6 shadow-[0_2px_10px_rgba(0,0,0,0.02)]" data-testid="internet-access-card">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e6f2fb] text-[#1974d2]">
            <Wifi size={20} aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-lg font-bold text-text-primary">Internet Access</h2>
            <p className="mt-1 text-[13px] text-text-secondary">Hostel Wi-Fi entitlement for your resident account.</p>
          </div>
        </div>
        {active ? (
          <button
            type="button"
            onClick={refreshSessions}
            disabled={!canRefreshSessions || refreshing || sessionsLoading}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-border bg-white px-3 py-2 text-xs font-semibold text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Refresh active devices"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : undefined} aria-hidden="true" />
            Refresh
          </button>
        ) : null}
      </div>

      {!account.hasAccess ? (
        <p className="text-sm leading-relaxed text-text-secondary">
          Internet access has not been activated for your account yet. Please contact hostel management if you believe this is incorrect.
        </p>
      ) : null}

      {setupUpdating ? (
        <p className="text-sm leading-relaxed text-text-secondary">
          Internet access setup is being updated. Please try again later or contact hostel management.
        </p>
      ) : null}

      {suspended ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Status</p>
              <span className={`mt-1 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusTone(account.status)}`}>
                {statusLabel(account.status)}
              </span>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Internet ID</p>
              <p className="mt-1 break-anywhere text-sm font-semibold text-text-primary">{account.internetId}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Device limit</p>
              <p className="mt-1 text-sm font-semibold text-text-primary">{deviceLimit} devices at a time</p>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-text-secondary">Please contact hostel management for assistance.</p>
        </div>
      ) : null}

      {active ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Status</p>
              <span className={`mt-1 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusTone("active")}`}>
                Active
              </span>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Internet ID</p>
              <p className="mt-1 break-anywhere text-sm font-semibold text-text-primary">{account.internetId}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Device limit</p>
              <p className="mt-1 text-sm font-semibold text-text-primary">{deviceLimit} devices at a time</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Active now</p>
              <p className="mt-1 text-sm font-semibold text-text-primary">
                {activeCount === null
                  ? "Temporarily unavailable"
                  : sessionsLoading && sessions === null
                    ? "Checking…"
                    : `${activeCount} of ${deviceLimit}`}
              </p>
            </div>
          </div>
          {atLimit ? (
            <p className="rounded-xl bg-[#fdf0e6] px-3 py-2 text-[13px] leading-snug text-[#c7691a]">
              Your 3-device limit is currently in use. Disconnect one device from Wi-Fi before connecting another.
            </p>
          ) : null}
          <ConnectionInstructions />
        </div>
      ) : null}

      {!active && account.hasAccess && !setupUpdating && !suspended ? (
        <p className="text-sm leading-relaxed text-text-secondary">
          Internet access setup is being updated. Please try again later or contact hostel management.
        </p>
      ) : null}
    </Card>
  );
}
