import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../auth/AuthContext";
import { RoomsPage } from "./RoomsPage";

const manager = { id: 1, userType: "staff", displayName: "Manager", email: "m@test", role: "manager", staffId: 1, residentId: null, sessionId: 1 };
const maintenance = { ...manager, role: "maintenance" };
const room = { id: 1, room_code: "ROOM-101", room_name: "Room 101", floor: "1", capacity: 4, gender_policy: "female", status: "available", bed_count: 3, active_occupancy: 2, availability: 1 };
const roomTwo = { id: 2, room_code: "ROOM-102", room_name: "Room 102", floor: "1", capacity: 2, gender_policy: "any", status: "maintenance" };
const beds = [
  { id: 10, room_id: 1, bed_code: "ROOM-101-A", label: "A", status: "available" },
  { id: 11, room_id: 1, bed_code: "ROOM-101-B", label: "B", status: "available" },
  { id: 12, room_id: 1, bed_code: "ROOM-101-C", label: "C", status: "maintenance" }
];
const allocations = [
  { id: 20, booking_id: 30, resident_id: 7, academic_session_id: 1, bed_id: 10, status: "active" },
  { id: 21, booking_id: 31, resident_id: 8, academic_session_id: 1, bed_id: 11, status: "active" }
];
const resident = { id: 7, user_id: 20, institution_id: 1, resident_code: "KSM-RES-0007", student_id: "UG-100", first_name: "Ama", last_name: "Mensah", status: "resident" };
const residentTwo = { ...resident, id: 8, resident_code: "KSM-RES-0008", first_name: "Kojo", last_name: "Boateng" };
const rate = { id: 5, room_id: 1, academic_session_id: 1, rate_code: "ROOM-101-2026", amount_minor: 250000, currency: "GHS", status: "active" };
const session = { id: 1, code: "2026", name: "2026/2027", status: "active" };
const occupancy = { total_usable_beds: 3, occupied_beds: 2, available_beds: 1, rooms: [{ room_code: "ROOM-101", configured_capacity: 4, active_bed_count: 3, occupied_bed_count: 2, gender_policy: "female", room_status: "available", active_rate_minor: 250000 }] };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function list(data: unknown) {
  return json({ ok: true, data, pagination: { limit: 100, offset: 0 } });
}

function renderRooms(options: { role?: "manager" | "maintenance"; rooms?: unknown[]; rates?: unknown[]; beds?: unknown[]; allocations?: unknown[]; failCreateBed?: boolean; failCreateRate?: boolean; failRooms?: boolean } = {}) {
  localStorage.setItem("kissmet_admin_token", "token");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/me")) return json({ user: options.role === "maintenance" ? maintenance : manager });
    if (url.includes("/admin/dashboard/occupancy")) return options.failRooms ? json({ error: { message: "Unable to load occupancy" } }, 500) : json({ ok: true, data: occupancy });
    if (url.includes("/admin/rooms?")) return list(options.rooms ?? [room, roomTwo]);
    if (url.endsWith("/admin/rooms/1")) return json({ ok: true, data: room });
    if (url.endsWith("/admin/rooms") && init?.method === "POST") return json({ ok: true, data: { ...room, id: 3, room_code: "ROOM-203" } }, 201);
    if (url.endsWith("/admin/rooms/1/status")) return json({ ok: true, data: { ...room, status: "maintenance" } });
    if (url.includes("/admin/rooms/1/beds")) return list(options.beds ?? beds);
    if (url.endsWith("/admin/beds") && init?.method === "POST") return options.failCreateBed ? json({ error: { message: "Room capacity exceeded" } }, 409) : json({ ok: true, data: { id: 13, room_id: 1, bed_code: "ROOM-101-D", label: "D", status: "available" } }, 201);
    if (url.endsWith("/admin/beds/11/status")) return json({ ok: true, data: { ...beds[1], status: "maintenance" } });
    if (url.endsWith("/admin/beds/12/status")) return json({ ok: true, data: { ...beds[2], status: "available" } });
    if (url.includes("/admin/room-rates?")) return list(options.rates ?? [rate]);
    if (url.endsWith("/admin/room-rates") && init?.method === "POST") return options.failCreateRate ? json({ error: { message: "UNIQUE constraint failed: active room rate" } }, 409) : json({ ok: true, data: { ...rate, id: 6, rate_code: "ROOM-101-NEW" } }, 201);
    if (url.endsWith("/admin/room-rates/5/status")) return json({ ok: true, data: { ...rate, status: "inactive" } });
    if (url.includes("/admin/academic-sessions")) return list([session]);
    if (url.includes("/admin/allocations")) return list(options.allocations ?? allocations);
    if (url.endsWith("/admin/residents/7")) return json({ ok: true, data: resident });
    if (url.endsWith("/admin/residents/8")) return json({ ok: true, data: residentTwo });
    return new Response(null, { status: 404 });
  });
  render(<MemoryRouter><AuthProvider><RoomsPage /></AuthProvider></MemoryRouter>);
}

async function openRoom() {
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Manage" }).length).toBeGreaterThan(0));
  await userEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]);
  return screen.findByText("Room Management");
}

describe("RoomsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders room list with configured capacity separate from actual bed inventory", async () => {
    renderRooms();
    expect(await screen.findByRole("heading", { name: "Rooms & Beds" })).toBeInTheDocument();
    expect(screen.getByText("ROOM-101 - Room 101")).toBeInTheDocument();
    expect(screen.getByText("GHS 2,500.00")).toBeInTheDocument();
    expect(screen.getByText("Usable Beds")).toBeInTheDocument();
    expect(screen.getByText("Available Beds")).toBeInTheDocument();
  });

  it("shows room detail using occupancy from active allocations", async () => {
    renderRooms();
    await openRoom();
    expect(screen.getByText("Configured capacity is the maximum; beds are the actual usable inventory.")).toBeInTheDocument();
    expect(screen.getByText("Ama Mensah")).toBeInTheDocument();
    expect(screen.getByText("Kojo Boateng")).toBeInTheDocument();
    expect(screen.getAllByText("Occupied bed protected")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Take Out of Service" })).toHaveLength(1);
  });

  it("creates a room without creating beds implicitly", async () => {
    renderRooms();
    await userEvent.click(await screen.findByRole("button", { name: /create room/i }));
    await userEvent.type(screen.getByLabelText("Room code"), "ROOM-203");
    await userEvent.type(screen.getByLabelText("Configured capacity"), "{selectall}4");
    await userEvent.click(screen.getAllByRole("button", { name: "Create Room" }).at(-1)!);
    await waitFor(() => {
      const post = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => String(url).endsWith("/admin/rooms") && init?.method === "POST");
      expect(post).toBeTruthy();
      expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url).endsWith("/admin/beds") && init?.method === "POST")).toBe(false);
    });
  });

  it("prevents obvious bed creation beyond configured capacity and surfaces backend capacity errors", async () => {
    renderRooms({ beds: [...beds, { id: 13, room_id: 1, bed_code: "ROOM-101-D", label: "D", status: "available" }] });
    await openRoom();
    await userEvent.click(screen.getByRole("button", { name: "Add Bed" }));
    expect(screen.getByRole("alert")).toHaveTextContent("configured capacity has already been reached");
  });

  it("creates a bed and supports safe bed status changes", async () => {
    renderRooms();
    await openRoom();
    await userEvent.click(screen.getByRole("button", { name: "Add Bed" }));
    await userEvent.type(screen.getByLabelText("Bed code"), "ROOM-101-D");
    await userEvent.type(screen.getByLabelText("Bed label"), "D");
    await userEvent.click(screen.getByRole("button", { name: "Create Bed" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url).endsWith("/admin/beds") && init?.method === "POST")).toBe(true));
  });

  it("takes an unoccupied available bed out of service", async () => {
    renderRooms({ allocations: [allocations[0]] });
    await openRoom();
    await userEvent.click(screen.getAllByRole("button", { name: "Take Out of Service" })[1]);
    expect(screen.getByText("This bed will no longer be available for new allocations.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url).endsWith("/admin/beds/11/status") && init?.method === "PATCH")).toBe(true));
  });

  it("creates room rates with integer minor units and handles duplicate active-rate errors", async () => {
    renderRooms({ failCreateRate: true });
    await openRoom();
    await userEvent.click(screen.getByRole("button", { name: "Add Rate" }));
    await userEvent.type(screen.getByLabelText("Rate code"), "ROOM-101-NEW");
    await userEvent.type(screen.getByLabelText("Amount"), "2500.00");
    await userEvent.click(screen.getByRole("button", { name: "Create Rate" }));
    await waitFor(() => {
      const post = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => String(url).endsWith("/admin/room-rates") && init?.method === "POST");
      expect(String(post?.[1]?.body)).toContain("\"amountMinor\":250000");
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("active room rate");
  });

  it("does not mutate historical booking pricing from room-rate operations", async () => {
    renderRooms();
    await openRoom();
    await userEvent.click(screen.getByRole("button", { name: "Mark Inactive" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).endsWith("/admin/room-rates/5/status"))).toBe(true));
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).includes("/admin/bookings"))).toBe(false);
  });

  it("hides write actions for roles without admin write permission", async () => {
    renderRooms({ role: "maintenance" });
    await screen.findByText("ROOM-101 - Room 101");
    expect(screen.queryByRole("button", { name: /create room/i })).not.toBeInTheDocument();
    await openRoom();
    expect(screen.queryByRole("button", { name: "Add Bed" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Rate" })).not.toBeInTheDocument();
  });

  it("shows API failure state", async () => {
    renderRooms({ failRooms: true });
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load occupancy");
  });
});
