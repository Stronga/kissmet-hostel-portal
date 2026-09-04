import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders title and message without action by default", () => {
    render(<EmptyState title="Nothing here" message="Try again later." />);
    expect(screen.getByRole("heading", { name: "Nothing here" })).toBeInTheDocument();
    expect(screen.getByText("Try again later.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders an optional next-action link", () => {
    render(
      <MemoryRouter>
        <EmptyState title="No booking" message="Start from application." actionHref="/application" actionLabel="Go to application" />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Go to application" })).toHaveAttribute("href", "/application");
  });
});
