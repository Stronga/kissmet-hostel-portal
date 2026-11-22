import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { ConnectorStatusCard } from "./ConnectorStatusCard";

const manager = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const reception = { ...manager, role: "reception" };

const online = {
  configured: true,
  staleAfterSeconds: 180,
  connectors: [{
    connectorId: "3f1c2b9e-8a7d-4c6b-9e5f-0a1b2c3d4e5f",
    lastSeenAt: "2026-11-22T12:00:00.000Z",
    ageSeconds: 15,
    stale: false,
    version: "0.1.0",
    hostname: "kissmet-pi",
    connectorStatus: "ok",
    routerosStatus: "ok",
    uptimeSeconds: 42,
    heartbeatCount: 4,
    firstSeenAt: "2026-11-22T10:00:00.000Z"
  }]
};

function ok(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
}

function renderCard(role: "manager" | "reception" = "manager", payload: unknown = online, health?: unknown) {
  localStorage.setItem("kissmet_admin_token", "token");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return new Response(JSON.stringify({ user: role === "manager" ? manager : reception }), { status: 200 });
    if (url.includes("/admin/internet-access/connector-status")) return ok(payload);
    if (url.includes("/admin/internet-access/connector-health")) return ok(health ?? { ok: true, configured: true, board: "hAP", version: "7.16" });
    return new Response(null, { status: 404 });
  });
  return render(<MemoryRouter><AuthProvider><ConnectorStatusCard showLiveProbe /></AuthProvider></MemoryRouter>);
}

describe("ConnectorStatusCard", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows online status, version, and RouterOS without secrets or URLs", async () => {
    renderCard();
    expect(await screen.findByText("Online")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Connector status" })).toBeInTheDocument();
    expect(screen.getByText("0.1.0")).toBeInTheDocument();
    expect(screen.getByText("ok")).toBeInTheDocument();
    expect(screen.getByText(/Last seen 15s ago/)).toBeInTheDocument();
    expect(screen.queryByText(/kissmet-pi|3f1c2b9e-8a7d|https?:\/\//i)).not.toBeInTheDocument();
  });

  it("shows a not-configured state", async () => {
    renderCard("manager", { configured: false, staleAfterSeconds: 180, connectors: [] });
    expect(await screen.findByText(/Heartbeat is not configured in this environment/i)).toBeInTheDocument();
  });

  it("shows offline when no heartbeat has been received", async () => {
    renderCard("manager", { configured: true, staleAfterSeconds: 180, connectors: [] });
    expect(await screen.findByText(/Waiting for the first heartbeat/i)).toBeInTheDocument();
    expect(screen.getByText(/Offline/)).toBeInTheDocument();
  });

  it("shows stale when the heartbeat is past two minutes but within the threshold", async () => {
    renderCard("manager", { ...online, connectors: [{ ...online.connectors[0], ageSeconds: 150, stale: false }] });
    expect(await screen.findByText("Stale")).toBeInTheDocument();
  });

  it("is hidden for roles without internet:read", async () => {
    renderCard("reception");
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("heading", { name: "Connector status" })).not.toBeInTheDocument();
    expect(vi.mocked(globalThis.fetch).mock.calls.every(([url]) => !String(url).includes("connector-status"))).toBe(true);
  });

  it("runs a rate-limited live probe on demand", async () => {
    renderCard();
    await screen.findByRole("heading", { name: "Connector status" });
    await userEvent.click(screen.getByRole("button", { name: "Run live probe" }));
    expect(await screen.findByText(/Live probe reachable · hAP · 7.16/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run live probe" })).toBeDisabled();
    expect(screen.getByText(/never shown/i)).toBeInTheDocument();
  });
});
