import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentReviewSection } from "./DocumentReviewSection";
import type { IdentityDocument } from "../../types/api";

const student: IdentityDocument = {
  id: 30,
  resident_id: 7,
  document_type: "student_card",
  status: "uploaded",
  original_filename: "student-card.pdf",
  content_type: "application/pdf",
  size_bytes: 1200,
  last_accessed_at: "2026-11-22T12:00:00.000Z",
  last_accessed_by: "Manager Staff"
};

describe("DocumentReviewSection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
  });

  it("shows a restricted-document notice without Ghana Card metadata", () => {
    render(<DocumentReviewSection documents={[]} hasRestrictedDocuments />);
    expect(screen.getByText(/restricted identity document is on file/i)).toBeInTheDocument();
    expect(screen.queryByText(/Ghana Card/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/filename|\.png|r2_key/i)).not.toBeInTheDocument();
  });

  it("downloads through the staff API and surfaces a 403 without exposing file bytes", async () => {
    render(<DocumentReviewSection documents={[student]} />);
    expect(screen.getByText("student-card.pdf")).toBeInTheDocument();
    expect(screen.getByText(/Last accessed/)).toBeInTheDocument();
    expect(screen.getByText(/Manager Staff/)).toBeInTheDocument();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { message: "Forbidden" } }), { status: 403 }));
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have permission to download this document.");
  });
});
