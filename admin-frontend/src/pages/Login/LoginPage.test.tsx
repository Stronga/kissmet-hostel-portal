import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { LoginPage } from "./LoginPage";

const staffUser = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };

describe("LoginPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("logs in successfully", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/staff/login")) return new Response(JSON.stringify({ token: "abc", expiresAt: "2099-01-01T00:00:00Z", user: { id: 1, name: "Manager", role: "manager" } }), { status: 200 });
      if (url.endsWith("/auth/me")) return new Response(JSON.stringify({ user: staffUser }), { status: 200 });
      return new Response(null, { status: 404 });
    });

    render(<MemoryRouter><AuthProvider><LoginPage /></AuthProvider></MemoryRouter>);
    await userEvent.type(screen.getByLabelText(/email or username/i), "manager");
    await userEvent.type(screen.getByLabelText(/^password$/i), "Password123!");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(localStorage.getItem("kissmet_admin_token")).toBe("abc"));
  });

  it("shows authentication errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401 }));
    render(<MemoryRouter><AuthProvider><LoginPage /></AuthProvider></MemoryRouter>);
    await userEvent.type(screen.getByLabelText(/email or username/i), "manager");
    await userEvent.type(screen.getByLabelText(/^password$/i), "bad");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid credentials");
  });
});
