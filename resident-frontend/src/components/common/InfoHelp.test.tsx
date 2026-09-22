import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { InfoHelp } from "./InfoHelp";

describe("InfoHelp", () => {
  it("opens on click, closes on Escape, and keeps content out of the way until opened", async () => {
    const user = userEvent.setup();
    render(
      <InfoHelp label="About verified payment">
        Outstanding balance uses verified payments only.
      </InfoHelp>
    );

    expect(screen.queryByText("Outstanding balance uses verified payments only.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "About verified payment" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Outstanding balance uses verified payments only.");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("closes when clicking outside", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">Outside</button>
        <InfoHelp label="About allocation">Active allocation is the room authority.</InfoHelp>
      </div>
    );

    await user.click(screen.getByRole("button", { name: "About allocation" }));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
