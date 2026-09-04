import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorState } from "./ErrorState";

describe("ErrorState", () => {
  it("renders message without retry by default", () => {
    render(<ErrorState message="Unable to load." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load.");
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("invokes optional retry handler", async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Failed" onRetry={onRetry} retryLabel="Try again" />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
