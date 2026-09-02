import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderResidentApp, residentEndpointResponse, residentUser, seedResidentToken } from "../../testUtils";

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

interface MockState {
  documents?: unknown[];
  failList?: boolean;
  failUpload?: boolean;
}

function mockDocuments(state: MockState = {}) {
  const requests: Array<{ url: string; method: string; body?: BodyInit | null }> = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({ url, method, body: init?.body });
    if (url.endsWith("/auth/me")) return json({ user: residentUser });
    if (url.endsWith("/resident/me/documents") && method === "GET") {
      if (state.failList) return json({ error: "Documents unavailable" }, 500);
      return json({ ok: true, data: state.documents ?? [] });
    }
    if (url.endsWith("/resident/me/documents/student-card") || url.endsWith("/resident/me/documents/ghana-card")) {
      if (state.failUpload) return json({ error: "Upload failed" }, 400);
      return json({ ok: true, data: { id: 9, document_type: url.includes("student-card") ? "student_card" : "ghana_card", status: "uploaded", original_filename: "upload.pdf", content_type: "application/pdf", size_bytes: 4 } }, 201);
    }
    return residentEndpointResponse(url) ?? json({ ok: true, data: [] });
  }));
  return requests;
}

describe("resident documents", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("protects /documents", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ error: "Unauthorized" }, 401)));
    render(renderResidentApp(["/documents"]));

    expect(await screen.findByRole("heading", { name: "Resident Portal" })).toBeInTheDocument();
  });

  it("shows loading and retryable error states", async () => {
    seedResidentToken();
    mockDocuments({ failList: true });
    render(renderResidentApp(["/documents"]));

    expect((await screen.findAllByText("Documents unavailable")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("shows empty required document cards without view links or storage data", async () => {
    seedResidentToken();
    mockDocuments();
    render(renderResidentApp(["/documents"]));

    expect(await screen.findByRole("heading", { name: "Documents" })).toBeInTheDocument();
    expect(screen.getByText("0 of 2 uploaded")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Student Card" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ghana Card" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /view/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/r2|bucket|identity\/|ghana card number/i)).not.toBeInTheDocument();
  });

  it("displays uploaded Student Card and Ghana Card metadata and statuses", async () => {
    seedResidentToken();
    mockDocuments({
      documents: [
        { id: 1, document_type: "student_card", status: "uploaded", original_filename: "student.pdf", content_type: "application/pdf", size_bytes: 1024, created_at: "2026-08-28T03:37:35.599Z" },
        { id: 2, document_type: "ghana_card", status: "verified", original_filename: "ghana.png", content_type: "image/png", size_bytes: 2048, created_at: "2026-08-28T03:37:35.599Z" }
      ]
    });
    render(renderResidentApp(["/documents"]));

    expect(await screen.findByText("2 of 2 uploaded")).toBeInTheDocument();
    expect(screen.getByText("student.pdf")).toBeInTheDocument();
    expect(screen.getByText("ghana.png")).toBeInTheDocument();
    expect(screen.getByText("Awaiting verification")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  it("shows rejected state with resident-safe reason and neutral fallback", async () => {
    seedResidentToken();
    mockDocuments({
      documents: [
        { id: 1, document_type: "student_card", status: "rejected", original_filename: "student.pdf", rejection_reason: "Image is unclear." },
        { id: 2, document_type: "ghana_card", status: "rejected", original_filename: "ghana.png" }
      ]
    });
    render(renderResidentApp(["/documents"]));

    expect(await screen.findByText("Image is unclear.")).toBeInTheDocument();
    expect(screen.getByText("This document needs to be uploaded again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-upload Student Card" })).toBeInTheDocument();
  });

  it("uploads Student Card with authenticated multipart form data and refreshes the list", async () => {
    seedResidentToken();
    const requests = mockDocuments();
    render(renderResidentApp(["/documents"]));

    const card = (await screen.findByRole("heading", { name: "Student Card" })).closest("section")!;
    const input = within(card).getByLabelText("Upload Student Card");
    await userEvent.upload(input, new File(["card"], "student.pdf", { type: "application/pdf" }));
    await userEvent.click(within(card).getByRole("button", { name: "Upload Student Card" }));

    await screen.findByText("Student Card uploaded.");
    const upload = requests.find((request) => request.url.endsWith("/resident/me/documents/student-card") && request.method === "POST");
    expect(upload?.body).toBeInstanceOf(FormData);
    expect(requests.filter((request) => request.url.endsWith("/resident/me/documents") && request.method === "GET")).toHaveLength(2);
  });

  it("uploads Ghana Card and prevents duplicate upload submission while in progress", async () => {
    seedResidentToken();
    let uploadCount = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return json({ user: residentUser });
      if (url.endsWith("/resident/me/documents") && (init?.method ?? "GET") === "GET") return json({ ok: true, data: [] });
      if (url.endsWith("/resident/me/documents/ghana-card")) {
        uploadCount += 1;
        return new Promise((resolve) => setTimeout(() => resolve(json({ ok: true, data: { id: 2, document_type: "ghana_card", status: "uploaded" } }, 201)), 200));
      }
      return residentEndpointResponse(url) ?? json({ ok: true, data: [] });
    }));
    render(renderResidentApp(["/documents"]));

    const card = (await screen.findByRole("heading", { name: "Ghana Card" })).closest("section")!;
    await userEvent.upload(within(card).getByLabelText("Upload Ghana Card"), new File(["card"], "ghana.webp", { type: "image/webp" }));
    const button = within(card).getByRole("button", { name: "Upload Ghana Card" });
    const firstClick = userEvent.click(button);
    const secondClick = userEvent.click(button);
    await Promise.all([firstClick, secondClick]);

    await screen.findByText("Ghana Card uploaded.");
    expect(uploadCount).toBe(1);
  });

  it("rejects unsupported and oversized files client-side", async () => {
    seedResidentToken();
    const requests = mockDocuments();
    render(renderResidentApp(["/documents"]));

    const card = (await screen.findByRole("heading", { name: "Student Card" })).closest("section")!;
    await userEvent.upload(within(card).getByLabelText("Upload Student Card"), new File(["bad"], "bad.txt", { type: "text/plain" }), { applyAccept: false });
    await userEvent.click(within(card).getByRole("button", { name: "Upload Student Card" }));
    expect(await screen.findByText("Choose a PDF, JPEG, PNG, or WebP file.")).toBeInTheDocument();

    const large = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.pdf", { type: "application/pdf" });
    await userEvent.upload(within(card).getByLabelText("Upload Student Card"), large);
    await userEvent.click(within(card).getByRole("button", { name: "Upload Student Card" }));
    expect(await screen.findByText("The maximum file size is 5 MB.")).toBeInTheDocument();
    expect(requests.some((request) => request.method === "POST")).toBe(false);
  });

  it("shows backend upload failure", async () => {
    seedResidentToken();
    mockDocuments({ failUpload: true });
    render(renderResidentApp(["/documents"]));

    const card = (await screen.findByRole("heading", { name: "Student Card" })).closest("section")!;
    await userEvent.upload(within(card).getByLabelText("Upload Student Card"), new File(["card"], "student.pdf", { type: "application/pdf" }));
    await userEvent.click(within(card).getByRole("button", { name: "Upload Student Card" }));

    expect(await screen.findByText("Upload failed")).toBeInTheDocument();
  });
});
