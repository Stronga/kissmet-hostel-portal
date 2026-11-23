import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "./client";

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

afterEach(() => vi.unstubAllGlobals());

describe("apiRequest domain error codes", () => {
  it("maps gender error codes to friendly messages and keeps the code", async () => {
    mockFetch(400, { ok: false, error: { code: "GENDER_NOT_ELIGIBLE_FOR_RESTRICTED_ROOM", message: "Gender not recorded" } });
    const err = await apiRequest("/admin/allocations", { method: "POST" }).catch((e: unknown) => e) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("GENDER_NOT_ELIGIBLE_FOR_RESTRICTED_ROOM");
    expect(err.message).toMatch(/only be placed in a mixed room/);
  });
  it("keeps the server message for generic codes", async () => {
    mockFetch(400, { ok: false, error: { code: "bad_request", message: "Booking not found" } });
    const err = await apiRequest("/x").catch((e: unknown) => e) as ApiError;
    expect(err.code).toBe("bad_request");
    expect(err.message).toBe("Booking not found");
  });
});
