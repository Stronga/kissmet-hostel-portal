import { useState } from "react";
import { ActivityItem } from "./ActivityItem";
import { BrandMark } from "./BrandMark";
import { Button } from "./Button";
import { DataTable } from "./DataTable";
import { Drawer } from "./Drawer";
import { Banner } from "./Feedback";
import { TextField } from "./Fields";
import { Modal } from "./Modal";
import { Pagination } from "./Pagination";
import { SearchFilterBar } from "./SearchFilterBar";
import { EmptyState, ErrorState, LoadingState, Skeleton } from "./States";
import { StatusBadge } from "./StatusBadge";
import { SummaryCard } from "./SummaryCard";
import { WorkflowSteps } from "./WorkflowSteps";
import { approvedContrastPairs } from "../tokens";

const rows = [
  { id: "example-1", name: "Example room", detail: "Example bed row" },
  { id: "example-2", name: "Second example", detail: "Collapsed until opened" }
];

export function Showcase() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [note, setNote] = useState("");

  return (
    <main style={{ minHeight: "100vh", background: "var(--km-color-background)", color: "var(--km-color-text)", fontFamily: "var(--km-font-sans)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "1.5rem", display: "grid", gap: "1.25rem" }}>
        <header style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <BrandMark height={72} alt="Kissmet" />
          <div>
            <p style={{ margin: 0, color: "var(--km-color-text-secondary)", fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>Design foundation</p>
            <h1 style={{ margin: "0.15rem 0 0", fontSize: "1.5rem" }}>Shared component preview</h1>
          </div>
        </header>

        <section aria-label="Brand colours" style={{ display: "grid", gap: "0.5rem" }}>
          {approvedContrastPairs.slice(0, 8).map((pair) => (
            <div key={pair.id} className="km-swatch" style={{ background: pair.background, color: pair.foreground, border: "1px solid var(--km-color-border-subtle)" }}>
              <span>{pair.id}</span>
              <span>{pair.foreground} on {pair.background}</span>
            </div>
          ))}
          <div className="km-swatch" style={{ background: "#142526", color: "#B9A17A" }}>
            <span>Gold on dark only</span>
            <span>#B9A17A on #142526</span>
          </div>
          <div className="km-swatch" style={{ background: "#F58220", color: "#142526" }}>
            <span>Orange fill, dark text</span>
            <span>#142526 on #F58220</span>
          </div>
        </section>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button icon aria-label="Icon action">+</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          <StatusBadge tone="success">Approved</StatusBadge>
          <StatusBadge tone="warning">Pending</StatusBadge>
          <StatusBadge tone="danger">Rejected</StatusBadge>
          <StatusBadge tone="info">Submitted</StatusBadge>
          <StatusBadge tone="neutral">Draft</StatusBadge>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
          <SummaryCard label="Static card" value="Example" helper="Not a live total" />
          <SummaryCard label="Clickable card" value="Open" helper="Button variant" tone="info" onClick={() => setDrawerOpen(true)} />
        </div>

        <SearchFilterBar label="Search examples" value={query} onChange={setQuery} placeholder="Filter the preview">
          <TextField label="Status" value="" onChange={() => undefined} hint="Filters stay beside search." />
        </SearchFilterBar>

        <WorkflowSteps
          steps={[
            { id: "draft", label: "Draft", state: "complete" },
            { id: "review", label: "Review", state: "current", detail: "Current stage" },
            { id: "decision", label: "Decision", state: "upcoming" }
          ]}
        />

        <DataTable
          caption="Example expandable table"
          columns={[
            { key: "name", header: "Record", render: (row) => row.name },
            { key: "detail", header: "Note", render: (row) => row.detail }
          ]}
          rows={rows}
          getRowId={(row) => row.id}
          defaultExpandedIds={["example-1"]}
          renderExpanded={(row) => <p style={{ margin: 0 }}>Nested detail for {row.name}. One level only.</p>}
        />
        <Pagination page={page} pageCount={4} onPageChange={setPage} />

        <ActivityItem
          title="Example task"
          detail="Unread is separate from unresolved."
          unread
          unresolved
          meta="Example queue"
          onClick={() => setDrawerOpen(true)}
        />

        <Banner tone="info" title="Preview only">These rows are component samples, not hostel records.</Banner>
        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <EmptyState title="Nothing here" message="Empty state sample." />
          <LoadingState label="Loading sample" />
          <Skeleton label="Skeleton sample" />
          <ErrorState title="Sample error" message="Error state sample." />
        </div>

        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Button onClick={() => setModalOpen(true)}>Open sample modal</Button>
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>Open sample drawer</Button>
        </div>
      </div>

      <Modal
        open={modalOpen}
        title="Example details"
        description="Header and footer stay in place while the body scrolls."
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Close</Button>
            <Button onClick={() => setModalOpen(false)}>Confirm sample</Button>
          </>
        }
      >
        <TextField label="Sample note" value={note} onChange={(event) => setNote(event.target.value)} hint="Inline help." error={note.length > 40 ? "Keep the sample note shorter." : undefined} />
        {Array.from({ length: 8 }, (_, index) => (
          <p key={index}>Sample paragraph {index + 1}. This text exists so the dialog body can scroll.</p>
        ))}
      </Modal>
      <Drawer open={drawerOpen} title="Example inspection" description="The list stays behind this drawer." onClose={() => setDrawerOpen(false)}>
        <p>Quick inspection sample. No record is loaded from a server.</p>
      </Drawer>
    </main>
  );
}
