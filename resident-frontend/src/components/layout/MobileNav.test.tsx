import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { MobileNav } from "./MobileNav";

describe("MobileNav", () => {
  it("marks More button active on a More-menu route", () => {
    render(
      <MemoryRouter initialEntries={["/messages"]}>
        <MobileNav isMoreOpen={false} onToggleMore={() => undefined} onCloseMore={() => undefined} onLogout={() => undefined} />
      </MemoryRouter>
    );
    const more = screen.getByRole("button", { name: /more/i });
    expect(more.className).toMatch(/text-primary/);
    expect(more).toHaveAttribute("aria-current", "page");
  });

  it("applies active styles to open More menu links", () => {
    render(
      <MemoryRouter initialEntries={["/profile"]}>
        <MobileNav isMoreOpen onToggleMore={() => undefined} onCloseMore={vi.fn()} onLogout={vi.fn()} />
      </MemoryRouter>
    );
    const profile = screen.getByRole("link", { name: /profile/i });
    expect(profile.className).toMatch(/text-primary/);
  });
});
