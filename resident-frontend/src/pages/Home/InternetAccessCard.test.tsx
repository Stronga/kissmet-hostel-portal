import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderResidentApp, residentUser, seedResidentToken } from "../../testUtils";

const profile = {
  id: 9,
  resident_code: "KSM-RES-0009",
  first_name: "Ama",
  middle_name: null,
  last_name: "Resident",
  status: "resident",
  phone_verified_at: "2026-08-28T03:37:35.599Z",
  phone: "+233555111222",
  email: "ama@example.com",
  institution_code: "UG",
  institution_name: "University of Ghana",
  student_id: "UG-123"
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

interface InternetMock {
  account?: unknown;
  sessions?: unknown;
  sessionsDelayMs?: number;
  failSessions?: boolean;
  sessionCalls?: { count: number };
}

function mockHomeWithInternet(state: InternetMock = {}) {
  const sessionCalls = state.sessionCalls ?? { count: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return json({ user: residentUser });
      if (url.endsWith("/resident/me")) return json({ ok: true, data: profile });
      if (url.endsWith("/resident/me/documents")) {
        return json({
          ok: true,
          data: [
            { id: 1, document_type: "student_card", status: "verified" },
            { id: 2, document_type: "ghana_card", status: "verified" }
          ]
        });
      }
      if (url.endsWith("/resident/me/applications")) return json({ ok: true, data: [] });
      if (url.endsWith("/resident/me/bookings")) return json({ ok: true, data: [] });
      if (url.endsWith("/resident/me/allocation")) return json({ ok: true, data: null });
      if (url.endsWith("/resident/me/payments/summary")) return json({ ok: true, data: null });
      if (url.endsWith("/resident/me/announcements")) return json({ ok: true, data: [] });
      if (url.endsWith("/resident/me/messages")) return json({ ok: true, data: [] });
      if (url.endsWith("/resident/me/internet-access/sessions")) {
        sessionCalls.count += 1;
        if (state.sessionsDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, state.sessionsDelayMs));
        }
        if (state.failSessions) return json({ error: "connector down" }, 503);
        return json({
          ok: true,
          data: state.sessions ?? { activeCount: 0, deviceLimit: 3 }
        });
      }
      if (url.endsWith("/resident/me/internet-access")) {
        return json({
          ok: true,
          data:
            state.account ?? {
              hasAccess: false,
              status: null,
              internetId: null,
              deviceLimit: 3,
              syncStatus: null
            }
        });
      }
      return json({ ok: true, data: [] });
    })
  );
  return sessionCalls;
}

describe("Home Internet Access card", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    seedResidentToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows no-access messaging when internet is not activated", async () => {
    mockHomeWithInternet();
    render(renderResidentApp(["/home"]));
    expect(
      await screen.findByText(/Internet access has not been activated for your account yet/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Refresh active devices/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/shared-users/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Enable|Suspend|Disconnect|Reset password/i)).not.toBeInTheDocument();
  });

  it("renders active card with 2 of 3 and connection instructions", async () => {
    mockHomeWithInternet({
      account: {
        hasAccess: true,
        status: "active",
        internetId: "KSM-RES-0009",
        deviceLimit: 3,
        syncStatus: "synced"
      },
      sessions: { activeCount: 2, deviceLimit: 3 }
    });
    render(renderResidentApp(["/home"]));

    const card = await screen.findByTestId("internet-access-card");
    expect(within(card).getByText("Internet Access")).toBeInTheDocument();
    expect(within(card).getByText("Active")).toBeInTheDocument();
    expect(within(card).getByText("KSM-RES-0009")).toBeInTheDocument();
    expect(within(card).getByText("3 devices at a time")).toBeInTheDocument();
    expect(await within(card).findByText("2 of 3")).toBeInTheDocument();
    expect(within(card).getByText(/Connect your device to the hostel Wi-Fi/i)).toBeInTheDocument();
    expect(within(card).getByText(/Enter your Internet ID and internet password/i)).toBeInTheDocument();
    expect(within(card).getByText(/OTP codes are not your Wi-Fi password/i)).toBeInTheDocument();
    expect(within(card).queryByText(/shared-users/i)).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /Enable|Suspend|Disconnect|Reset/i })).not.toBeInTheDocument();
  });

  it("shows limit message at 3 of 3", async () => {
    mockHomeWithInternet({
      account: {
        hasAccess: true,
        status: "active",
        internetId: "KSM-RES-0009",
        deviceLimit: 3,
        syncStatus: "synced"
      },
      sessions: { activeCount: 3, deviceLimit: 3 }
    });
    render(renderResidentApp(["/home"]));
    expect(await screen.findByText("3 of 3")).toBeInTheDocument();
    expect(
      screen.getByText(/Your 3-device limit is currently in use/i)
    ).toBeInTheDocument();
  });

  it("shows suspended state without unsuspend controls", async () => {
    mockHomeWithInternet({
      account: {
        hasAccess: true,
        status: "suspended",
        internetId: "KSM-RES-0009",
        deviceLimit: 3,
        syncStatus: "synced"
      }
    });
    render(renderResidentApp(["/home"]));
    const card = await screen.findByTestId("internet-access-card");
    expect(within(card).getByText("Suspended")).toBeInTheDocument();
    expect(within(card).getByText("KSM-RES-0009")).toBeInTheDocument();
    expect(within(card).getByText(/Please contact hostel management for assistance/i)).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /unsuspend|enable/i })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /Refresh active devices/i })).not.toBeInTheDocument();
  });

  it("shows pending/failed setup message without connector errors", async () => {
    mockHomeWithInternet({
      account: {
        hasAccess: true,
        status: "active",
        internetId: "KSM-RES-0009",
        deviceLimit: 3,
        syncStatus: "failed"
      }
    });
    render(renderResidentApp(["/home"]));
    expect(
      await screen.findByText(/Internet access setup is being updated/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/connector/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/192\.168/i)).not.toBeInTheDocument();
  });

  it("shows temporarily unavailable when live count cannot load", async () => {
    mockHomeWithInternet({
      account: {
        hasAccess: true,
        status: "active",
        internetId: "KSM-RES-0009",
        deviceLimit: 3,
        syncStatus: "synced"
      },
      failSessions: true
    });
    render(renderResidentApp(["/home"]));
    const card = await screen.findByTestId("internet-access-card");
    expect(await within(card).findByText(/Temporarily unavailable/i)).toBeInTheDocument();
    expect(within(card).getByText("Active")).toBeInTheDocument();
    expect(within(card).getByText("KSM-RES-0009")).toBeInTheDocument();
  });

  it("locks Refresh while a sessions request is in flight", async () => {
    const sessionCalls = mockHomeWithInternet({
      account: {
        hasAccess: true,
        status: "active",
        internetId: "KSM-RES-0009",
        deviceLimit: 3,
        syncStatus: "synced"
      },
      sessions: { activeCount: 1, deviceLimit: 3 },
      sessionsDelayMs: 300
    });
    const user = userEvent.setup();
    render(renderResidentApp(["/home"]));

    const card = await screen.findByTestId("internet-access-card");
    expect(await within(card).findByText("1 of 3")).toBeInTheDocument();
    const refresh = within(card).getByRole("button", { name: /Refresh active devices/i });
    expect(refresh).not.toBeDisabled();
    const before = sessionCalls.count;
    await user.click(refresh);
    expect(refresh).toBeDisabled();
    await user.click(refresh);
    await waitFor(() => expect(sessionCalls.count).toBe(before + 1));
    await waitFor(() => expect(refresh).not.toBeDisabled());
  });

  it("preserves mobile home shell with internet card present", async () => {
    mockHomeWithInternet();
    render(renderResidentApp(["/home"]));
    expect(await screen.findByText("Welcome, Ama Resident")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Accommodation journey mobile" })).toBeInTheDocument();
    const card = await screen.findByTestId("internet-access-card");
    expect(card).toBeInTheDocument();
    expect(
      await within(card).findByText(/Internet access has not been activated for your account yet/i)
    ).toBeInTheDocument();
  });
});
