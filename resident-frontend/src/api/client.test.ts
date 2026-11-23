import { afterEach, describe, expect, it, vi } from "vitest";
import { apiDownload, apiRequest } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("apiRequest credentials", () => {
  it("sends credentials include so Access cookies can ride with Bearer auth", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await apiRequest("/health");
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ credentials: "include" }));
  });

  it("sends credentials include on downloads", async () => {
    const fetchMock = vi.fn(async () => new Response("pdf", {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="doc.pdf"' }
    }));
    vi.stubGlobal("fetch", fetchMock);
    await apiDownload("/resident/documents/1");
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ credentials: "include" }));
  });
});
