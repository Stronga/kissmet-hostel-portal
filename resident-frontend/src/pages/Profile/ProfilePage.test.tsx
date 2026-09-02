import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderResidentApp, residentUser, seedResidentToken } from "../../testUtils";

const profile = {
  id: 9,
  resident_code: "KSM-RES-0009",
  first_name: "Ama",
  middle_name: "Efua",
  last_name: "Resident",
  status: "applicant",
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

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)));
}

describe("resident profile", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    seedResidentToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is protected by the resident auth route", async () => {
    localStorage.clear();
    mockFetch(() => json({ error: "Unauthorized" }, 401));
    render(renderResidentApp(["/profile"]));

    expect(await screen.findByRole("heading", { name: "Resident Portal" })).toBeInTheDocument();
  });

  it("renders real resident identity and safe fields", async () => {
    mockFetch((url) => {
      if (url.endsWith("/auth/me")) return json({ user: residentUser });
      if (url.endsWith("/resident/me")) return json({ ok: true, data: profile });
      return json({ ok: true, data: [] });
    });
    render(renderResidentApp(["/profile"]));

    expect(await screen.findByText("Ama Efua Resident")).toBeInTheDocument();
    expect(screen.getByText("University of Ghana")).toBeInTheDocument();
    expect(screen.getByText("UG-123")).toBeInTheDocument();
    expect(screen.getByText("KSM-RES-0009")).toBeInTheDocument();
    expect(screen.getByText("+233555111222")).toBeInTheDocument();
    expect(screen.getByText("ama@example.com")).toBeInTheDocument();
    expect(screen.queryByText("9")).not.toBeInTheDocument();
    expect(screen.queryByText(/session|hash|otp/i)).not.toBeInTheDocument();
  });

  it("handles missing optional phone and email safely", async () => {
    mockFetch((url) => {
      if (url.endsWith("/auth/me")) return json({ user: residentUser });
      if (url.endsWith("/resident/me")) return json({ ok: true, data: { ...profile, phone: null, email: null, middle_name: null } });
      return json({ ok: true, data: [] });
    });
    render(renderResidentApp(["/profile"]));

    expect(await screen.findByText("Ama Resident")).toBeInTheDocument();
    expect((await screen.findAllByText("Not available")).length).toBeGreaterThanOrEqual(2);
  });

  it("updates only backend-supported profile fields", async () => {
    mockFetch((url, init) => {
      if (url.endsWith("/auth/me")) return json({ user: residentUser });
      if (url.endsWith("/resident/me") && init?.method === "PATCH") {
        expect(JSON.parse(String(init.body))).toMatchObject({ firstName: "Akua", middleName: null, lastName: "Resident", email: "akua@example.com" });
        return json({ ok: true, data: { ...profile, first_name: "Akua", middle_name: null, email: "akua@example.com" } });
      }
      if (url.endsWith("/resident/me")) return json({ ok: true, data: profile });
      return json({ ok: true, data: [] });
    });
    render(renderResidentApp(["/profile"]));

    await screen.findByDisplayValue("Ama");
    await userEvent.clear(screen.getByLabelText("First name"));
    await userEvent.type(screen.getByLabelText("First name"), "Akua");
    await userEvent.clear(screen.getByLabelText("Middle name"));
    await userEvent.clear(screen.getByLabelText("Email"));
    await userEvent.type(screen.getByLabelText("Email"), "akua@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));

    expect(await screen.findByText("Profile updated.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Akua Resident")).toBeInTheDocument());
  });

  it("validates editable profile fields for usability", async () => {
    mockFetch((url) => {
      if (url.endsWith("/auth/me")) return json({ user: residentUser });
      if (url.endsWith("/resident/me")) return json({ ok: true, data: profile });
      return json({ ok: true, data: [] });
    });
    render(renderResidentApp(["/profile"]));

    await screen.findByDisplayValue("Ama");
    await userEvent.clear(screen.getByLabelText("First name"));
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));

    expect(await screen.findByText("First name and last name are required.")).toBeInTheDocument();
  });
});
