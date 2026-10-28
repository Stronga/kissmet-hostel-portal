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

  it("keeps Other self-registration disabled with a clear boundary message", async () => {
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>
    );
    expect(await screen.findByRole("heading", { name: "Resident Registration" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Resident Type")).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Institution"), "__other__");
    expect(screen.getByLabelText("Ghana Card Number")).toBeInTheDocument();
    expect(screen.getByText(/Other self-registration and login are deferred/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Other registration unavailable/i })).toBeDisabled();
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
