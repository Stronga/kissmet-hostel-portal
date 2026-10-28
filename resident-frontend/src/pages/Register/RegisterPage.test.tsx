import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { AppRoutes } from "../../routes/AppRoutes";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

describe("resident registration Institution/Other boundary", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("institutions")) {
        return json({ ok: true, data: [{ code: "ug", name: "University of Ghana" }] });
      }
      return json({ ok: true, data: [] });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("enables Other registration with Ghana Card Number and no fake institution row", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("institutions")) {
        return json({ ok: true, data: [{ code: "ug", name: "University of Ghana" }] });
      }
      if (url.includes("/resident/register/request-otp")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        expect(body).toMatchObject({
          institutionCode: "__other__",
          ghanaCardNumber: "GHA-123456789-0",
          firstName: "Ama",
          lastName: "Other"
        });
        expect(body.studentId).toBeUndefined();
        return json({ ok: true, message: "sent" });
      }
      return json({ ok: true, data: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>
    );
    expect(await screen.findByRole("heading", { name: "Resident Registration" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Resident Type")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("First name"), "Ama");
    await userEvent.type(screen.getByLabelText("Last name"), "Other");
    await userEvent.type(screen.getByLabelText("Phone number"), "0241234567");
    await userEvent.selectOptions(screen.getByLabelText("Institution"), "__other__");
    expect(screen.getByLabelText("Ghana Card Number")).toBeInTheDocument();
    expect(screen.getByText(/upload a Ghana Card document/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Ghana Card Number"), "GHA-123456789-0");
    expect(screen.getByRole("button", { name: /Start Registration/i })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: /Start Registration/i }));
    expect(await screen.findByRole("heading", { name: "Verify OTP" })).toBeInTheDocument();
  });

  it("asks for Student ID when a listed institution is selected", async () => {
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>
    );
    await screen.findByRole("heading", { name: "Resident Registration" });
    await userEvent.selectOptions(screen.getByLabelText("Institution"), "ug");
    expect(screen.getByLabelText("Student ID / School Number")).toBeInTheDocument();
    expect(screen.queryByLabelText("Ghana Card Number")).not.toBeInTheDocument();
  });
});
