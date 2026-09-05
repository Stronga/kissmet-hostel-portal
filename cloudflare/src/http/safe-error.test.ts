import { describe, expect, it } from "vitest";
import { publicErrorMessage, routeError } from "./safe-error";

describe("safe public errors", () => {
  it("keeps intentional service messages", () => {
    expect(publicErrorMessage(new Error("Document not found"))).toBe("Document not found");
    expect(publicErrorMessage(new Error("Invalid or expired OTP"))).toBe("Invalid or expired OTP");
  });

  it("redacts SQL/UNIQUE/stack-like messages", () => {
    expect(publicErrorMessage(new Error("UNIQUE constraint failed: applications.resident_id"))).toBe("Conflict with an existing record");
    expect(publicErrorMessage(new Error("D1_ERROR: SQLITE_ERROR at /workspace/foo.ts:12"))).toBe("Request failed");
  });

  it("maps conflict status for UNIQUE failures", () => {
    const result = routeError(new Error("UNIQUE constraint failed"));
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ ok: false, error: { message: "Conflict with an existing record" } });
  });
});
