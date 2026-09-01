import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESIDENT_TOKEN_KEY } from "../../auth/AuthContext";
import { loginContext, registrationContext, saveVerificationContext } from "../../auth/verificationContext";
import { renderResidentApp, residentUser, seedResidentToken, staffUser } from "../../testUtils";

const institutions = [{ code: "ug", name: "University of Ghana" }, { code: "knust", name: "KNUST" }];

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)));
}

function body(init?: RequestInit) {
  return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
}

describe("resident login and OTP authentication", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads institutions on the login page", async () => {
    mockFetch((url) => url.endsWith("/public/institutions") ? json({ ok: true, data: institutions }) : json({ error: "Unauthorized" }, 401));
    render(renderResidentApp(["/login"]));

    expect(await screen.findByRole("option", { name: "University of Ghana" })).toBeInTheDocument();
  });

  it("validates required institution and student ID", async () => {
    mockFetch((url) => url.endsWith("/public/institutions") ? json({ ok: true, data: institutions }) : json({ ok: true }));
    render(renderResidentApp(["/login"]));

    await screen.findByRole("option", { name: "University of Ghana" });
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Institution is required.")).toBeInTheDocument();
    expect(screen.getByText("Student ID is required.")).toBeInTheDocument();
  });

  it("requests login OTP and passes login context to verification", async () => {
    mockFetch((url, init) => {
      if (url.endsWith("/public/institutions")) return json({ ok: true, data: institutions });
      if (url.endsWith("/auth/resident/request-otp")) {
        expect(body(init)).toMatchObject({ institutionCode: "ug", studentId: "ST-1" });
        return json({ ok: true, message: "If the resident can receive OTP messages, an OTP has been sent." });
      }
      return json({ error: "Unauthorized" }, 401);
    });
    render(renderResidentApp(["/login"]));

    await userEvent.selectOptions(await screen.findByLabelText("Institution"), "ug");
    await userEvent.type(screen.getByLabelText("Student ID"), "ST-1");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "Verify OTP" })).toBeInTheDocument();
    expect(screen.getByText(/University of Ghana student ID ST-1/i)).toBeInTheDocument();
  });

  it("shows a safe login OTP request failure", async () => {
    mockFetch((url) => {
      if (url.endsWith("/public/institutions")) return json({ ok: true, data: institutions });
      if (url.endsWith("/auth/resident/request-otp")) return json({ error: "Too many login attempts" }, 429);
      return json({ ok: true });
    });
    render(renderResidentApp(["/login"]));

    await userEvent.selectOptions(await screen.findByLabelText("Institution"), "ug");
    await userEvent.type(screen.getByLabelText("Student ID"), "ST-1");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText(/Too many attempts/i)).toBeInTheDocument();
  });

  it("blocks duplicate login OTP submission while pending", async () => {
    let requestCount = 0;
    mockFetch((url) => {
      if (url.endsWith("/public/institutions")) return json({ ok: true, data: institutions });
      if (url.endsWith("/auth/resident/request-otp")) {
        requestCount += 1;
        return new Promise<Response>((resolve) => setTimeout(() => resolve(json({ ok: true, message: "sent" })), 50));
      }
      return json({ ok: true });
    });
    render(renderResidentApp(["/login"]));

    await userEvent.selectOptions(await screen.findByLabelText("Institution"), "ug");
    await userEvent.type(screen.getByLabelText("Student ID"), "ST-1");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByRole("button", { name: "Sending OTP" }));

    await waitFor(() => expect(requestCount).toBe(1));
  });

  it("shows invalid and expired OTP messages safely", async () => {
    saveVerificationContext(loginContext({ institutionCode: "ug", studentId: "ST-1" }, "University of Ghana"));
    mockFetch((url) => {
      if (url.endsWith("/auth/resident/verify-otp")) return json({ error: "Invalid or expired OTP" }, 401);
      return json({ error: "Unauthorized" }, 401);
    });
    render(renderResidentApp(["/verify-otp"]));

    await userEvent.type(await screen.findByLabelText("Verification code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText(/expired/i)).toBeInTheDocument();
  });

  it("verifies login OTP, stores token, and redirects home", async () => {
    saveVerificationContext(loginContext({ institutionCode: "ug", studentId: "ST-1" }, "University of Ghana"));
    mockFetch((url) => {
      if (url.endsWith("/auth/resident/verify-otp")) return json({ token: "resident-token", expiresAt: "2026-09-01T12:00:00.000Z" });
      if (url.endsWith("/auth/me")) return json({ user: residentUser });
      return json({ ok: true });
    });
    render(renderResidentApp(["/verify-otp"]));

    await userEvent.type(await screen.findByLabelText("Verification code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText(/Welcome, Ama Resident/i)).toBeInTheDocument();
    expect(localStorage.getItem(RESIDENT_TOKEN_KEY)).toBe("resident-token");
  });

  it("resends login OTP through the backend request endpoint", async () => {
    saveVerificationContext(loginContext({ institutionCode: "ug", studentId: "ST-1" }, "University of Ghana"));
    let resendCount = 0;
    mockFetch((url) => {
      if (url.endsWith("/auth/resident/request-otp")) {
        resendCount += 1;
        return json({ ok: true, message: "sent" });
      }
      return json({ error: "Unauthorized" }, 401);
    });
    render(renderResidentApp(["/verify-otp"]));

    await userEvent.click(await screen.findByRole("button", { name: "Resend OTP" }));
    expect(await screen.findByText(/new OTP has been sent/i)).toBeInTheDocument();
    expect(resendCount).toBe(1);
  });

  it("fails safely when verification context is missing after refresh", async () => {
    mockFetch(() => json({ error: "Unauthorized" }, 401));
    render(renderResidentApp(["/verify-otp"]));

    expect(await screen.findByText(/Verification details are no longer available/i)).toBeInTheDocument();
  });

  it("redirects public auth routes to home when already authenticated", async () => {
    seedResidentToken();
    mockFetch(() => json({ user: residentUser }));
    render(renderResidentApp(["/register"]));

    expect(await screen.findByText(/Welcome, Ama Resident/i)).toBeInTheDocument();
  });

  it("rejects a non-resident auth result during OTP verification", async () => {
    saveVerificationContext(loginContext({ institutionCode: "ug", studentId: "ST-1" }, "University of Ghana"));
    mockFetch((url) => {
      if (url.endsWith("/auth/resident/verify-otp")) return json({ token: "staff-token", expiresAt: "2026-09-01T12:00:00.000Z" });
      if (url.endsWith("/auth/me")) return json({ user: staffUser });
      return json({ ok: true });
    });
    render(renderResidentApp(["/verify-otp"]));

    await userEvent.type(await screen.findByLabelText("Verification code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(localStorage.getItem(RESIDENT_TOKEN_KEY)).toBeNull());
    expect(screen.getByText(/could not reach|Request failed/i)).toBeInTheDocument();
  });
});

describe("resident registration OTP authentication", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the registration form and loads institutions", async () => {
    mockFetch((url) => url.endsWith("/public/institutions") ? json({ ok: true, data: institutions }) : json({ ok: true }));
    render(renderResidentApp(["/register"]));

    expect(await screen.findByRole("heading", { name: "Resident Registration" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "University of Ghana" })).toBeInTheDocument();
  });

  it("validates required registration fields", async () => {
    mockFetch((url) => url.endsWith("/public/institutions") ? json({ ok: true, data: institutions }) : json({ ok: true }));
    render(renderResidentApp(["/register"]));

    await screen.findByRole("option", { name: "University of Ghana" });
    await userEvent.click(screen.getByRole("button", { name: "Start Registration" }));

    expect(await screen.findByText("First name is required.")).toBeInTheDocument();
    expect(screen.getByText("Last name is required.")).toBeInTheDocument();
    expect(screen.getByText("Phone number is required.")).toBeInTheDocument();
  });

  it("requests registration OTP and passes registration context to verification", async () => {
    mockFetch((url, init) => {
      if (url.endsWith("/public/institutions")) return json({ ok: true, data: institutions });
      if (url.endsWith("/resident/register/request-otp")) {
        expect(body(init)).toMatchObject({ firstName: "Ama", lastName: "Resident", phone: "+233555111222", institutionCode: "ug", studentId: "ST-1" });
        return json({ ok: true, message: "If registration can proceed, an OTP has been sent." });
      }
      return json({ ok: true });
    });
    render(renderResidentApp(["/register"]));

    await userEvent.type(await screen.findByLabelText("First name"), "Ama");
    await userEvent.type(screen.getByLabelText("Last name"), "Resident");
    await userEvent.type(screen.getByLabelText("Phone number"), "+233555111222");
    await userEvent.type(screen.getByLabelText("Student ID"), "ST-1");
    await userEvent.selectOptions(screen.getByLabelText("Institution"), "ug");
    await userEvent.click(screen.getByRole("button", { name: "Start Registration" }));

    expect(await screen.findByRole("heading", { name: "Verify OTP" })).toBeInTheDocument();
    expect(screen.getByText(/University of Ghana student ID ST-1/i)).toBeInTheDocument();
  });

  it("shows registration OTP request failure", async () => {
    mockFetch((url) => {
      if (url.endsWith("/public/institutions")) return json({ ok: true, data: institutions });
      if (url.endsWith("/resident/register/request-otp")) return json({ error: "Too many attempts" }, 429);
      return json({ ok: true });
    });
    render(renderResidentApp(["/register"]));

    await userEvent.type(await screen.findByLabelText("First name"), "Ama");
    await userEvent.type(screen.getByLabelText("Last name"), "Resident");
    await userEvent.type(screen.getByLabelText("Phone number"), "+233555111222");
    await userEvent.type(screen.getByLabelText("Student ID"), "ST-1");
    await userEvent.selectOptions(screen.getByLabelText("Institution"), "ug");
    await userEvent.click(screen.getByRole("button", { name: "Start Registration" }));

    expect(await screen.findByText(/Too many attempts/i)).toBeInTheDocument();
  });

  it("verifies registration OTP, creates a session, and redirects home", async () => {
    saveVerificationContext(registrationContext({
      firstName: "Ama",
      middleName: null,
      lastName: "Resident",
      phone: "+233555111222",
      email: null,
      institutionCode: "ug",
      studentId: "ST-1"
    }, "University of Ghana"));
    mockFetch((url) => {
      if (url.endsWith("/resident/register/verify-otp")) return json({ ok: true, data: { token: "new-resident-token", resident: {} } });
      if (url.endsWith("/auth/me")) return json({ user: residentUser });
      return json({ ok: true });
    });
    render(renderResidentApp(["/verify-otp"]));

    await userEvent.type(await screen.findByLabelText("Verification code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText(/Welcome, Ama Resident/i)).toBeInTheDocument();
    expect(localStorage.getItem(RESIDENT_TOKEN_KEY)).toBe("new-resident-token");
  });

  it("resends registration OTP with the preserved registration payload", async () => {
    saveVerificationContext(registrationContext({
      firstName: "Ama",
      middleName: null,
      lastName: "Resident",
      phone: "+233555111222",
      email: null,
      institutionCode: "ug",
      studentId: "ST-1"
    }, "University of Ghana"));
    mockFetch((url, init) => {
      if (url.endsWith("/resident/register/request-otp")) {
        expect(body(init)).toMatchObject({ phone: "+233555111222", institutionCode: "ug", studentId: "ST-1" });
        return json({ ok: true, message: "sent" });
      }
      return json({ error: "Unauthorized" }, 401);
    });
    render(renderResidentApp(["/verify-otp"]));

    await userEvent.click(await screen.findByRole("button", { name: "Resend OTP" }));
    expect(await screen.findByText(/new OTP has been sent/i)).toBeInTheDocument();
  });
});
