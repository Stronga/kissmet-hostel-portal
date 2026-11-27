import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DataTable } from "./DataTable";
import { Drawer } from "./Drawer";
import { Modal } from "./Modal";
import { NavShell } from "./NavShell";
import { Pagination } from "./Pagination";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders semantic tones", () => {
    render(
      <>
        <StatusBadge tone="success">Approved</StatusBadge>
        <StatusBadge tone="warning">Pending</StatusBadge>
        <StatusBadge tone="danger">Rejected</StatusBadge>
        <StatusBadge tone="info">Submitted</StatusBadge>
        <StatusBadge tone="neutral">Draft</StatusBadge>
      </>
    );
    expect(screen.getByText("Approved")).toHaveClass("km-badge--success");
    expect(screen.getByText("Pending")).toHaveClass("km-badge--warning");
    expect(screen.getByText("Rejected")).toHaveClass("km-badge--danger");
    expect(screen.getByText("Submitted")).toHaveClass("km-badge--info");
    expect(screen.getByText("Draft")).toHaveClass("km-badge--neutral");
  });
});

describe("DataTable", () => {
  const rows = [
    { id: "a", name: "Example room" },
    { id: "b", name: "Second room" }
  ];

  function renderTable() {
    return render(
      <DataTable
        caption="Example rooms"
        columns={[{ key: "name", header: "Room", render: (row) => row.name }]}
        rows={rows}
        getRowId={(row) => row.id}
        renderExpanded={(row) => <p>Details for {row.name}</p>}
      />
    );
  }

  it("expands and collapses a row from the button and the keyboard", async () => {
    const user = userEvent.setup();
    renderTable();
    const first = screen.getByRole("button", { name: "Expand Example room" });
    expect(first).toHaveAttribute("aria-expanded", "false");
    await user.click(first);
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Details for Example room")).toBeInTheDocument();
    first.focus();
    await user.keyboard("{Enter}");
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Details for Example room")).not.toBeInTheDocument();
    await user.keyboard(" ");
    expect(first).toHaveAttribute("aria-expanded", "true");
  });

  it("moves between expand controls with arrow keys", async () => {
    const user = userEvent.setup();
    renderTable();
    const first = screen.getByRole("button", { name: "Expand Example room" });
    const second = screen.getByRole("button", { name: "Expand Second room" });
    first.focus();
    await user.keyboard("{ArrowDown}");
    expect(second).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(first).toHaveFocus();
  });
});

function DialogHarness({ kind }: { kind: "modal" | "drawer" }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      {kind === "modal" ? (
        <Modal
          open={open}
          title="Example record"
          onClose={close}
          footer={<button type="button">Save</button>}
        >
          <label>
            Note
            <input aria-label="Note" />
          </label>
        </Modal>
      ) : (
        <Drawer open={open} title="Example record" onClose={close}>
          <label>
            Note
            <input aria-label="Note" />
          </label>
        </Drawer>
      )}
    </>
  );
}

describe("Modal and Drawer", () => {
  it.each(["modal", "drawer"] as const)("traps focus and closes %s on Escape", async (kind) => {
    const user = userEvent.setup();
    render(<DialogHarness kind={kind} />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = await screen.findByRole("dialog", { name: "Example record" });
    expect(dialog.querySelector(kind === "modal" ? ".km-modal__header" : ".km-drawer__header")).toBeTruthy();
    if (kind === "modal") {
      expect(dialog.querySelector(".km-modal__footer")).toBeTruthy();
      expect(dialog.querySelector(".km-modal__body")).toBeTruthy();
    }
    await waitFor(() => expect(screen.getByRole("button", { name: "Close" })).toHaveFocus());
    await user.tab();
    expect(screen.getByLabelText("Note")).toHaveFocus();
    if (kind === "modal") {
      await user.tab();
      expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
    }
    await user.tab();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();
  });
});

describe("NavShell", () => {
  it("collapses a group and the sidebar control", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <NavShell
        label="Admin navigation"
        onToggleCollapsed={onToggle}
        groups={[{
          id: "finance",
          label: "Finance",
          items: [{ id: "payments", label: "Payments", href: "/payments" }]
        }]}
        renderItem={(item) => <a href={item.href}>{item.label}</a>}
      />
    );
    const group = screen.getByRole("button", { name: "Finance" });
    expect(group).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Payments" })).toBeInTheDocument();
    await user.click(group);
    expect(group).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Payments" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});

describe("Pagination", () => {
  it("disables the edges of the range", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={1} pageCount={3} onPageChange={onPageChange} />);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});
