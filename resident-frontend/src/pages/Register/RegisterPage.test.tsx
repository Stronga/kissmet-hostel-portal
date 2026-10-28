import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { AppRoutes } from "../../routes/AppRoutes";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

describe("resident registration boundary", () => {
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

  it("keeps non-student self-registration disabled with a clear boundary message", async () => {
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>
    );
    expect(await screen.findByRole("heading", { name: "Resident Registration" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Resident Type"), "non_student");
    expect(screen.getByText(/Non-student self-registration and login are deferred/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Non-student registration unavailable/i })).toBeDisabled();
  });
});
