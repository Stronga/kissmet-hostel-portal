import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { AllocationsPage } from "./AllocationsPage";

const manager = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const accounts = { ...manager, role: "accounts" };
const session = { id: 1, code: "2026", name: "2026/2027", status: "active" };
const institution = { id: 1, code: "UG", name: "University of Ghana", status: "active" };
const rooms = [
  { id: 1, room_code: "ROOM-101", room_name: "Room 101", floor: "1", capacity: 2, gender_policy: "female", status: "available" },
  { id: 2, room_code: "ROOM-102", room_name: "Room 102", floor: "1", capacity: 2, gender_policy: "female", status: "available" },
  { id: 3, room_code: "ROOM-201", room_name: "Room 201", floor: "2", capacity: 2, gender_policy: "male", status: "available" }
];
const roomBeds = {
  1: [{ id: 10, room_id: 1, bed_code: "ROOM-101-A", label: "A", status: "available" }, { id: 11, room_id: 1, bed_code: "ROOM-101-B", label: "B", status: "available" }],
  2: [{ id: 20, room_id: 2, bed_code: "ROOM-102-A", label: "A", status: "available" }],
  3: [{ id: 30, room_id: 3, bed_code: "ROOM-201-A", label: "A", status: "available" }]
} as Record<number, unknown[]>;
const rates = [
  { id: 1, room_id: 1, academic_session_id: 1, rate_code: "R101-2026", amount_minor: 250000, currency: "GHS", status: "active" },
  { id: 2, room_id: 2, academic_session_id: 1, rate_code: "R102-2026", amount_minor: 250000, currency: "GHS", status: "active" },
  { id: 3, room_id: 3, academic_session_id: 1, rate_code: "R201-2026", amount_minor: 300000, currency: "GHS", status: "active" }
];
const residents = [
  { id: 7, user_id: 20, institution_id: 1, resident_code: "KSM-RES-0007", student_id: "UG-100", first_name: "Ama", last_name: "Mensah", gender: "female", status: "resident" },
  { id: 8, user_id: 21, institution_id: 1, resident_code: "KSM-RES-0008", student_id: "UG-101", first_name: "Kojo", last_name: "Boateng", gender: "male", status: "resident" },
  { id: 9, user_id: 22, institution_id: 1, resident_code: "KSM-RES-0009", student_id: "UG-102", first_name: "Efua", last_name: "Adjei", gender: "female", status: "resident" }
];
const bookings = [
  { id: 100, resident_id: 7, academic_session_id: 1, application_id: 50, booking_number: "KSM-BKG-0100", status: "confirmed", total_amount_minor: 250000, currency: "GHS", priced_room_id: 1, priced_room_rate_id: 1, created_at: "2026-08-28T03:37:35.599Z" },
  { id: 101, resident_id: 8, academic_session_id: 1, application_id: 51, booking_number: "KSM-BKG-0101", status: "pending", total_amount_minor: 250000, currency: "GHS", priced_room_id: 1, priced_room_rate_id: 1 },
  { id: 102, resident_id: 9, academic_session_id: 1, application_id: 52, booking_number: "KSM-BKG-0102", status: "confirmed", total_amount_minor: 250000, currency: "GHS", priced_room_id: 1, priced_room_rate_id: 1 }
];
const allocations = [
  { id: 1, booking_id: 100, resident_id: 7, academic_session_id: 1, bed_id: 10, status: "active", starts_on: "2026-08-28T03:37:35.599Z", assigned_by_staff_id: 1 },
  { id: 2, booking_id: 99, resident_id: 7, academic_session_id: 1, bed_id: 11, status: "transferred", starts_on: "2026-08-01T03:37:35.599Z", ends_on: "2026-08-28T03:37:35.599Z" }
];
const availability = [
  { room_id: 1, room_code: "ROOM-101", room_name: "Room 101", capacity: 2, gender_policy: "female", bed_id: 11, bed_code: "ROOM-101-B", label: "B", amount_minor: 250000, currency: "GHS" },
  { room_id: 2, room_code: "ROOM-102", room_name: "Room 102", capacity: 2, gender_policy: "female", bed_id: 20, bed_code: "ROOM-102-A", label: "A", amount_minor: 250000, currency: "GHS" },
  { room_id: 3, room_code: "ROOM-201", room_name: "Room 201", capacity: 2, gender_policy: "male", bed_id: 30, bed_code: "ROOM-201-A", label: "A", amount_minor: 300000, currency: "GHS" }
];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function list(data: unknown) {
  return json({ ok: true, data, pagination: { limit: 100, offset: 0 } });
}

function renderAllocations(options: { role?: "manager" | "accounts"; allocations?: unknown[]; bookings?: unknown[]; availability?: unknown[]; failCreate?: boolean; failTransfer?: boolean; failStatus?: boolean; failLoad?: boolean } = {}) {
  localStorage.setItem("kissmet_admin_token", "token");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return json({ user: options.role === "accounts" ? accounts : manager });
    if (url.includes("/admin/allocations?")) return options.failLoad ? json({ error: { message: "Unable to load allocations" } }, 500) : list(options.allocations ?? allocations);
    if (url.endsWith("/admin/allocations/1")) return json({ ok: true, data: allocations[0] });
    if (url.endsWith("/admin/allocations") && init?.method === "POST") return options.failCreate ? json({ error: { message: "Resident already allocated" } }, 409) : json({ ok: true, data: { id: 3, booking_id: 102, resident_id: 9, academic_session_id: 1, bed_id: 20, status: "active", starts_on: "2026-08-30" } }, 201);
    if (url.endsWith("/admin/allocations/1/transfer")) return options.failTransfer ? json({ error: { message: "Destination room rate differs from booking financial basis" } }, 400) : json({ ok: true, data: { id: 4, booking_id: 100, resident_id: 7, academic_session_id: 1, bed_id: 20, status: "active", starts_on: "2026-08-30" } }, 201);
    if (url.endsWith("/admin/allocations/1/status")) return options.failStatus ? json({ error: { message: "Invalid workflow transition" } }, 400) : json({ ok: true, data: { ...allocations[0], status: "ended", ends_on: "2026-08-30" } });
    if (url.includes("/admin/bookings?")) return list(options.bookings ?? bookings);
    if (url.endsWith("/admin/bookings/100")) return json({ ok: true, data: bookings[0] });
    if (url.endsWith("/admin/bookings/99")) return json({ ok: true, data: { ...bookings[0], id: 99, booking_number: "KSM-BKG-0099" } });
    if (url.includes("/admin/availability")) return json({ ok: true, data: options.availability ?? availability });
    if (url.includes("/admin/academic-sessions")) return list([session]);
    if (url.includes("/admin/institutions")) return list([institution]);
    if (url.includes("/admin/rooms?")) return list(rooms);
    if (url.includes("/admin/room-rates")) return list(rates);
    const bedMatch = url.match(/\/admin\/rooms\/(\d+)\/beds/);
    if (bedMatch) return list(roomBeds[Number(bedMatch[1])] ?? []);
    const residentMatch = url.match(/\/admin\/residents\/(\d+)/);
    if (residentMatch) return json({ ok: true, data: residents.find((resident) => resident.id === Number(residentMatch[1])) });
    return new Response(null, { status: 404 });
  });
  render(<MemoryRouter><AuthProvider><AllocationsPage /></AuthProvider></MemoryRouter>);
}

async function openDetail() {
  await waitFor(() => expect(screen.getByText("KSM-BKG-0100")).toBeInTheDocument());
  await userEvent.click(screen.getAllByRole("button", { name: "View" })[0]);
  return screen.findByText("Allocation Details");
}

describe("AllocationsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders allocations list with human-readable dates and currency detail", async () => {
    renderAllocations();
    expect(await screen.findByRole("heading", { name: "Allocations" })).toBeInTheDocument();
    expect(screen.getAllByText("Ama Mensah").length).toBeGreaterThan(0);
    expect(screen.getByText("ROOM-101 / ROOM-101-A")).toBeInTheDocument();
    expect(screen.getAllByText("28 Aug 2026, 3:37 AM").length).toBeGreaterThan(0);
    await openDetail();
    expect(screen.getByText("GHS 2,500.00")).toBeInTheDocument();
  });

  it("only offers confirmed bookings without duplicate active session allocations", async () => {
    renderAllocations();
    await userEvent.click(await screen.findByRole("button", { name: /allocate bed/i }));
    const bookingSelect = screen.getByLabelText("Eligible booking");
    expect(within(bookingSelect).queryByText(/KSM-BKG-0100/)).not.toBeInTheDocument();
    expect(within(bookingSelect).queryByText(/KSM-BKG-0101/)).not.toBeInTheDocument();
    expect(within(bookingSelect).getByText(/KSM-BKG-0102/)).toBeInTheDocument();
  });

  it("requires a specific compatible bed and creates allocation without changing booking financial basis", async () => {
    renderAllocations();
    await userEvent.click(await screen.findByRole("button", { name: /allocate bed/i }));
    await userEvent.selectOptions(screen.getByLabelText("Eligible booking"), "102");
    await screen.findByText("R101-2026 GHS 2,500.00");
    expect(screen.queryByText(/ROOM-201-A/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Allocation" })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Destination bed"), "20");
    await userEvent.click(screen.getByRole("button", { name: "Create Allocation" }));
    await waitFor(() => {
      const post = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => String(url).endsWith("/admin/allocations") && init?.method === "POST");
      expect(String(post?.[1]?.body)).toContain("\"bedId\":20");
      expect(String(post?.[1]?.body)).not.toContain("total_amount_minor");
      expect(String(post?.[1]?.body)).not.toContain("priced_room_id");
    });
  });

  it("supports same-room and same-priced cross-room transfer while preserving old allocation history", async () => {
    renderAllocations();
    await openDetail();
    await userEvent.click(screen.getByRole("button", { name: "Transfer" }));
    await waitFor(() => expect(screen.getAllByText("ROOM-101 / ROOM-101-A").length).toBeGreaterThan(1));
    expect(screen.getByText("1 differently priced bed option(s) hidden")).toBeInTheDocument();
    expect(screen.getAllByText(/ROOM-101 \/ ROOM-101-B/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ROOM-102 \/ ROOM-102-A/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/ROOM-201 \/ ROOM-201-A/)).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Transfer destination bed"), "20");
    await userEvent.click(screen.getByRole("button", { name: "Transfer Allocation" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).endsWith("/admin/allocations/1/transfer"))).toBe(true));
    expect(screen.getAllByText("Transferred").length).toBeGreaterThan(1);
  });

  it("surfaces differently priced transfer rejection from backend", async () => {
    renderAllocations({ failTransfer: true, availability: [{ ...availability[2], amount_minor: 250000 }] });
    await openDetail();
    await userEvent.click(screen.getByRole("button", { name: "Transfer" }));
    await userEvent.selectOptions(screen.getByLabelText("Transfer destination bed"), "30");
    await userEvent.click(screen.getByRole("button", { name: "Transfer Allocation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Destination room rate differs");
  });

  it("supports end/cancel/archive actions where backend status rules allow", async () => {
    renderAllocations();
    await openDetail();
    await userEvent.click(screen.getByRole("button", { name: "End Allocation" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url).endsWith("/admin/allocations/1/status") && init?.method === "PATCH")).toBe(true));
  });

  it("hides write actions without allocation write permission", async () => {
    renderAllocations({ role: "accounts" });
    expect(await screen.findByText("KSM-BKG-0100")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /allocate bed/i })).not.toBeInTheDocument();
    await openDetail();
    expect(screen.queryByRole("button", { name: "Transfer" })).not.toBeInTheDocument();
    expect(screen.getByText("No write permission.")).toBeInTheDocument();
  });

  it("shows API error states and mutation failures", async () => {
    renderAllocations({ failLoad: true });
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load allocations");
  });

  it("surfaces allocation create failure", async () => {
    renderAllocations({ failCreate: true });
    await userEvent.click(await screen.findByRole("button", { name: /allocate bed/i }));
    await userEvent.selectOptions(screen.getByLabelText("Eligible booking"), "102");
    await screen.findByText(/ROOM-102 \/ ROOM-102-A/);
    await userEvent.selectOptions(screen.getByLabelText("Destination bed"), "20");
    await userEvent.click(screen.getByRole("button", { name: "Create Allocation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Resident already allocated");
  });
});
