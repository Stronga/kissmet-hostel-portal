import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { ResidentsPage } from "./ResidentsPage";

const manager = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const accounts = { ...manager, role: "accounts" };
const resident = { id: 7, user_id: 20, institution_id: 1, resident_code: "KSM-RES-0007", student_id: "UG-100", first_name: "Ama", last_name: "Mensah", gender: "female", status: "applicant" };
const institution = { id: 1, code: "ug", name: "University of Ghana", status: "active" };

function ok(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data, pagination: { limit: 25, offset: 0 } }), { status: 200 });
}

function renderWithAuth(role: "manager" | "accounts" = "manager") {
  localStorage.setItem("kissmet_admin_token", "token");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return new Response(JSON.stringify({ user: role === "manager" ? manager : accounts }), { status: 200 });
    if (url.includes("/admin/institutions")) return ok([institution]);
    if (url.includes("/admin/residents?")) return ok([resident]);
    if (url.endsWith("/admin/residents/7")) return new Response(JSON.stringify({ ok: true, data: resident }), { status: 200 });
    if (url.endsWith("/admin/residents") && init?.method === "POST") return new Response(JSON.stringify({ ok: true, data: { ...resident, id: 8, resident_code: "KSM-RES-0008" } }), { status: 201 });
    return new Response(null, { status: 404 });
  });
  render(<MemoryRouter><AuthProvider><ResidentsPage /></AuthProvider></MemoryRouter>);
}

describe("ResidentsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("loads residents and renders real API fields", async () => {
    renderWithAuth();
    expect(await screen.findByRole("heading", { name: "Residents" })).toBeInTheDocument();
    expect(await screen.findByText("KSM-RES-0007")).toBeInTheDocument();
    expect(screen.getByText("UG-100")).toBeInTheDocument();
    expect(screen.getByText("University of Ghana")).toBeInTheDocument();
    expect(screen.getAllByText("Applicant").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /add resident/i })).toBeInTheDocument();
  });

  it("hides Add Resident for roles without resident write permission", async () => {
    renderWithAuth("accounts");
    await screen.findByText("KSM-RES-0007");
    expect(screen.queryByRole("button", { name: /add resident/i })).not.toBeInTheDocument();
  });

  it("opens resident detail without exposing private identity URLs", async () => {
    renderWithAuth();
    await userEvent.click(await screen.findByRole("button", { name: /view/i }));
    expect(await screen.findByText("Resident Details")).toBeInTheDocument();
    expect(screen.getByText("Private files are not exposed in this listing")).toBeInTheDocument();
  });

  it("submits server-side resident search", async () => {
    renderWithAuth();
    await screen.findByText("KSM-RES-0007");
    await userEvent.type(screen.getByLabelText(/search residents/i), "Ama");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining("search=Ama"), expect.anything()));
  });

  it("creates a resident through the backend and never enters resident code", async () => {
    renderWithAuth();
    await userEvent.click(await screen.findByRole("button", { name: /add resident/i }));
    await userEvent.type(screen.getByLabelText("First name"), "Kojo");
    await userEvent.type(screen.getByLabelText("Last name"), "Boateng");
    await userEvent.type(screen.getByLabelText("Student ID"), "UG-200");
    await userEvent.selectOptions(screen.getByLabelText("Institution"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Create Resident" }));
    await waitFor(() => {
      const postCall = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => String(url).endsWith("/admin/residents") && init?.method === "POST");
      expect(postCall).toBeTruthy();
      expect(String(postCall?.[1]?.body)).not.toContain("resident_code");
    });
  });

  it("shows API error state", async () => {
    localStorage.setItem("kissmet_admin_token", "token");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return new Response(JSON.stringify({ user: manager }), { status: 200 });
      return new Response(JSON.stringify({ error: { message: "Unable to load residents." } }), { status: 500 });
    });
    render(<MemoryRouter><AuthProvider><ResidentsPage /></AuthProvider></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load residents.");
  });
});
