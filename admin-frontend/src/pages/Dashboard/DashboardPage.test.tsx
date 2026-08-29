import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage";

const envelope = (data: unknown, status = 200) => new Response(JSON.stringify(status === 200 ? { ok: true, data } : { error: "Unable to load dashboard." }), { status });

describe("DashboardPage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows loading state", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => undefined));
    render(<DashboardPage />);
    expect(screen.getByText("Loading dashboard...")).toBeInTheDocument();
  });

  it("renders successful dashboard response", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/overview")) return envelope({ total_residents: 4, active_residents: 2, applicants: 2, occupied_beds: 1, available_beds: 3, occupancy_percentage: 25, pending_applications: 1, confirmed_bookings: 1, open_maintenance_requests: 1, urgent_maintenance_requests: 1, active_academic_session: "2026/2027" });
      if (url.endsWith("/occupancy")) return envelope({ total_usable_beds: 4, occupied_beds: 1, available_beds: 3, occupancy_percentage: 25, rooms: [] });
      if (url.endsWith("/finance")) return envelope({ expected_booking_revenue: 350000, verified_payments: 100000, outstanding_booking_balances: 250000 });
      if (url.endsWith("/applications")) return envelope({ submitted_applications: 1, under_review_applications: 1, approved_applications: 1, rejected_applications: 0, pending_bookings: 1, confirmed_bookings: 1 });
      if (url.endsWith("/maintenance")) return envelope({ open: 1, assigned: 0, in_progress: 0, resolved: 0, urgent: 1 });
      return envelope({});
    });
    render(<DashboardPage />);
    expect(await screen.findByText("GHS 3,500.00")).toBeInTheDocument();
    expect(await screen.findByText(/2026\/2027/)).toBeInTheDocument();
  });

  it("shows dashboard error state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(envelope({}, 500));
    render(<DashboardPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load dashboard.");
  });
});
