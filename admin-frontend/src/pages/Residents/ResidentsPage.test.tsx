import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { ResidentsPage } from "./ResidentsPage";

const manager = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const accounts = { ...manager, role: "accounts" };
const resident = { id: 7, user_id: 20, institution_id: 1, resident_code: "KSM-RES-0007", student_id: "UG-100", first_name: "Ama", last_name: "Mensah", gender: "female", status: "applicant", resident_kind: "student" };
const institution = { id: 1, code: "ug", name: "University of Ghana", status: "active" };

function ok(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data, pagination: { limit: 25, offset: 0 } }), { status: 200 });
}

type Extra = (url: string, init?: RequestInit) => Response | null;
const reception = { ...manager, role: "reception" };

function renderWithAuth(role: "manager" | "accounts" | "reception" = "manager", extra?: Extra) {
  localStorage.setItem("kissmet_admin_token", "token");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const custom = extra?.(url, init);
    if (custom) return custom;
    if (url.endsWith("/admin/gender-placement-conflicts")) return ok([]);
    if (url.endsWith("/auth/me")) return new Response(JSON.stringify({ user: role === "manager" ? manager : role === "reception" ? reception : accounts }), { status: 200 });
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
    await userEvent.type(screen.getByLabelText("Student ID / School Number"), "UG-200");
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

  it("uses Institution including Other and does not require a Resident Type choice", async () => {
    renderWithAuth();
    expect(await screen.findByText("University of Ghana")).toBeInTheDocument();
    expect(screen.queryByText("Resident Type")).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /add resident/i }));
    expect(screen.queryByLabelText("Resident Type")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Institution")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Institution"), "1");
    expect(screen.getByLabelText("Student ID / School Number")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Institution"), "__other__");
    expect(screen.getByLabelText("Ghana Card Number")).toBeInTheDocument();
    expect(screen.queryByLabelText("Student ID / School Number")).not.toBeInTheDocument();
  });

  it("creates an Other resident with Ghana Card Number and without student ID", async () => {
    renderWithAuth();
    await userEvent.click(await screen.findByRole("button", { name: /add resident/i }));
    await userEvent.selectOptions(screen.getByLabelText("Institution"), "__other__");
    await userEvent.type(screen.getByLabelText("First name"), "Abena");
    await userEvent.type(screen.getByLabelText("Last name"), "Owusu");
    await userEvent.type(screen.getByLabelText("Ghana Card Number"), "GHA-123456789-0");
    await userEvent.click(screen.getByRole("button", { name: "Create Resident" }));
    await waitFor(() => {
      const postCall = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => String(url).endsWith("/admin/residents") && init?.method === "POST");
      expect(postCall).toBeTruthy();
      const body = JSON.parse(String(postCall?.[1]?.body));
      expect(body.institutionId).toBeNull();
      expect(body.studentId).toBeNull();
      expect(body.ghanaCardNumber).toBe("GHA-123456789-0");
      expect(body.residentKind).toBeUndefined();
    });
  });

  it("masks Other Ghana Card identifiers in the list when provided by the API", async () => {
    localStorage.setItem("kissmet_admin_token", "token");
    const other = {
      id: 9,
      user_id: 21,
      institution_id: null,
      resident_code: "KSM-RES-0009",
      student_id: null,
      first_name: "Kojo",
      last_name: "Other",
      gender: "male",
      status: "applicant",
      resident_kind: "non_student",
      ghana_card_number_masked: "************789-0",
      has_ghana_card_number: true,
      identifier_type: "ghana_card_number"
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return new Response(JSON.stringify({ user: manager }), { status: 200 });
      if (url.includes("/admin/institutions")) return ok([institution]);
      if (url.includes("/admin/residents?")) return ok([other]);
      return new Response(null, { status: 404 });
    });
    render(<MemoryRouter><AuthProvider><ResidentsPage /></AuthProvider></MemoryRouter>);
    expect(await screen.findByText("Other")).toBeInTheDocument();
    expect(screen.getByText("************789-0")).toBeInTheDocument();
    expect(screen.queryByText("GHA-123456789-0")).not.toBeInTheDocument();
  });


  describe("gender correction", () => {
    const conflict = { kind: "booking", allocationId: null, bookingId: 31, bookingNumber: "KSM-BKG-0031", bookingStatus: "confirmed", residentId: 7, roomId: 4, roomCode: "F-101", roomGenderPolicy: "female", code: "GENDER_NOT_ELIGIBLE_FOR_RESTRICTED_ROOM" };

    it("is offered to managers", async () => {
      renderWithAuth("manager");
      await userEvent.click(await screen.findByRole("button", { name: /view/i }));
      expect(await screen.findByRole("form", { name: /correct gender/i })).toBeInTheDocument();
    });

    it("hides the correction form for reception", async () => {
      renderWithAuth("reception");
      await userEvent.click(await screen.findByRole("button", { name: /view/i }));
      expect(await screen.findByText("Resident Details")).toBeInTheDocument();
      expect(screen.queryByRole("form", { name: /correct gender/i })).not.toBeInTheDocument();
    });

    it("shows conflicts on 409, requires acknowledgement, then applies and refreshes the conflicts panel", async () => {
      const bodies: unknown[] = [];
      let conflictsListed = false;
      renderWithAuth("manager", (url, init) => {
        if (url.endsWith("/admin/residents/7/gender-correction") && init?.method === "POST") {
          const body = JSON.parse(String(init.body));
          bodies.push(body);
          if (!body.acknowledgeConflicts) {
            return new Response(JSON.stringify({ ok: false, error: { code: "GENDER_CORRECTION_CONFLICTS", message: "Correction would leave active placements" }, data: { applied: false, requiresAcknowledgement: true, conflicts: [conflict] } }), { status: 409 });
          }
          conflictsListed = true;
          return new Response(JSON.stringify({ ok: true, data: { applied: true, requiresAcknowledgement: false, resident: { ...resident, gender: "not_specified" }, conflicts: [conflict] } }), { status: 200 });
        }
        if (url.endsWith("/admin/gender-placement-conflicts")) return ok(conflictsListed ? [conflict] : []);
        return null;
      });
      await userEvent.click(await screen.findByRole("button", { name: /view/i }));
      await screen.findByRole("form", { name: /correct gender/i });
      await userEvent.selectOptions(screen.getByLabelText("Corrected gender"), "not_specified");
      await userEvent.selectOptions(screen.getByLabelText("Correction reason"), "resident_request");
      await userEvent.click(screen.getByRole("button", { name: /^correct gender$/i }));
      expect(await screen.findByText(/confirmed booking KSM-BKG-0031 in Female-only room F-101/i)).toBeInTheDocument();
      const apply = screen.getByRole("button", { name: /apply and flag placements/i });
      expect(apply).toBeDisabled();
      await userEvent.click(screen.getByRole("checkbox"));
      await userEvent.click(apply);
      expect(await screen.findByText(/1 placement\(s\) flagged for transfer/i)).toBeInTheDocument();
      expect(bodies).toEqual([
        { gender: "not_specified", reasonCode: "resident_request", acknowledgeConflicts: false },
        { gender: "not_specified", reasonCode: "resident_request", acknowledgeConflicts: true }
      ]);
      await waitFor(() => expect(screen.getByRole("region", { name: /gender placement conflicts/i })).toBeInTheDocument());
    });

    it("refuses to submit without a reason or with the already-recorded value", async () => {
      renderWithAuth("manager");
      await userEvent.click(await screen.findByRole("button", { name: /view/i }));
      await screen.findByRole("form", { name: /correct gender/i });
      await userEvent.click(screen.getByRole("button", { name: /^correct gender$/i }));
      expect(await screen.findByText("Choose the corrected gender and a reason.")).toBeInTheDocument();
      await userEvent.selectOptions(screen.getByLabelText("Corrected gender"), "female");
      await userEvent.selectOptions(screen.getByLabelText("Correction reason"), "data_entry_error");
      await userEvent.click(screen.getByRole("button", { name: /^correct gender$/i }));
      expect(await screen.findByText("That gender is already recorded.")).toBeInTheDocument();
    });
  });
});
