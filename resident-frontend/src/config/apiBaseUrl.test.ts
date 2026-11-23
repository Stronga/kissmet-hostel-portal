import { describe, expect, it } from "vitest";
import {
  DEV_API_BASE_URL_FALLBACK,
  InvalidApiBaseUrlError,
  isProductionMode,
  resolveApiBaseUrl,
  viteApiBaseUrlGuard,
} from "./apiBaseUrl";

describe("isProductionMode", () => {
  it("is true only for production", () => {
    expect(isProductionMode("production")).toBe(true);
    expect(isProductionMode("development")).toBe(false);
    expect(isProductionMode("test")).toBe(false);
    expect(isProductionMode("staging")).toBe(false);
    expect(isProductionMode(undefined)).toBe(false);
  });
});

describe("resolveApiBaseUrl in development and test", () => {
  it.each(["development", "test"])("falls back to localhost:8787 when unset in %s", (mode) => {
    expect(resolveApiBaseUrl(undefined, mode)).toBe(DEV_API_BASE_URL_FALLBACK);
    expect(resolveApiBaseUrl("", mode)).toBe(DEV_API_BASE_URL_FALLBACK);
    expect(resolveApiBaseUrl("   ", mode)).toBe(DEV_API_BASE_URL_FALLBACK);
  });

  it("keeps an explicit dev URL, including http localhost", () => {
    expect(resolveApiBaseUrl("http://localhost:8787", "development")).toBe("http://localhost:8787");
    expect(resolveApiBaseUrl("http://127.0.0.1:8787", "development")).toBe("http://127.0.0.1:8787");
    expect(resolveApiBaseUrl("  http://localhost:8787  ", "test")).toBe("http://localhost:8787");
  });
});

describe("resolveApiBaseUrl in production", () => {
  const ok = "https://api.kissmetgroup.org";

  it("accepts an absolute https URL", () => {
    expect(resolveApiBaseUrl(ok, "production")).toBe(ok);
    expect(resolveApiBaseUrl("  https://staging-api.kissmetgroup.org  ", "production")).toBe(
      "https://staging-api.kissmetgroup.org",
    );
    expect(resolveApiBaseUrl("https://kissmet-hostel-api-staging.example.workers.dev", "production")).toBe(
      "https://kissmet-hostel-api-staging.example.workers.dev",
    );
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace", "   "],
    ["relative", "/api"],
    ["protocol-relative", "//api.kissmetgroup.org"],
    ["not a URL", "not a url"],
    ["http (not https)", "http://api.kissmetgroup.org"],
    ["localhost http", "http://localhost:8787"],
    ["localhost https", "https://localhost"],
    ["127.0.0.1 https", "https://127.0.0.1"],
    ["127.0.0.1 http", "http://127.0.0.1:8787"],
    ["IPv6 loopback", "https://[::1]"],
    ["0.0.0.0", "https://0.0.0.0"],
    ["*.localhost", "https://api.localhost"],
  ])("rejects %s", (_label, value) => {
    expect(() => resolveApiBaseUrl(value, "production")).toThrow(InvalidApiBaseUrlError);
    try {
      resolveApiBaseUrl(value, "production");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("VITE_API_BASE_URL");
      const raw = String(value ?? "").trim();
      if (raw.length > 0) expect(message).not.toContain(raw);
    }
  });
});

describe("viteApiBaseUrlGuard", () => {
  const plugin = viteApiBaseUrlGuard();

  it("does not run during dev serve or non-production builds", () => {
    expect(() =>
      plugin.configResolved({ command: "serve", mode: "development", env: {} }),
    ).not.toThrow();
    expect(() =>
      plugin.configResolved({ command: "build", mode: "development", env: {} }),
    ).not.toThrow();
    expect(() =>
      plugin.configResolved({ command: "build", mode: "test", env: {} }),
    ).not.toThrow();
  });

  it("fails a production build when the URL is missing or invalid", () => {
    expect(() =>
      plugin.configResolved({ command: "build", mode: "production", env: {} }),
    ).toThrow(InvalidApiBaseUrlError);
    expect(() =>
      plugin.configResolved({
        command: "build",
        mode: "production",
        env: { VITE_API_BASE_URL: "http://localhost:8787" },
      }),
    ).toThrow(InvalidApiBaseUrlError);
  });

  it("allows a production build with a valid https URL", () => {
    expect(() =>
      plugin.configResolved({
        command: "build",
        mode: "production",
        env: { VITE_API_BASE_URL: "https://api.kissmetgroup.org" },
      }),
    ).not.toThrow();
  });
});
