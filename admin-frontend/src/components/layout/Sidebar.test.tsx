import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

const routes = [
  "Dashboard",
  "Residents",
  "Applications",
  "Bookings",
  "Rooms & Beds",
  "Allocations",
  "Payments",
  "Receipts",
  "Refunds",
  "Reports",
  "Maintenance",
  "Internet Access",
  "Announcements",
  "Messaging",
  "Staff",
  "Setup",
  "Audit Logs",
  "Settings"
];

describe("admin sidebar", () => {
  it("keeps every authorized route inside the new groups", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Sidebar role="manager" />
      </MemoryRouter>
    );
    for (const label of ["Overview", "Residents & Admissions", "Accommodation", "Finance", "Operations", "Communications", "Administration & Configuration"]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-expanded", "true");
    }
    for (const route of routes) {
      expect(screen.getByRole("link", { name: route })).toBeInTheDocument();
    }
    await user.click(screen.getByRole("button", { name: "Finance" }));
    expect(screen.queryByRole("link", { name: "Payments" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("preserves role limits while regrouping", () => {
    render(
      <MemoryRouter>
        <Sidebar role="reception" onToggleCollapsed={vi.fn()} />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Applications" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bookings" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Announcements" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reports" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Payments" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Internet Access" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Staff" })).not.toBeInTheDocument();
  });
});
