import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readHeaders(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function connectSrc(headers: string) {
  const match = /connect-src ([^;]+);/.exec(headers);
  expect(match, "expected connect-src in CSP").not.toBeNull();
  return match![1];
}

describe("admin Pages CSP headers", () => {
  it("keeps production _headers pointed only at the production API", () => {
    const csp = connectSrc(readHeaders("public/_headers"));
    expect(csp).toContain("https://api.kissmetgroup.org");
    expect(csp).not.toContain("staging-api.kissmetgroup.org");
  });

  it("uses a staging-specific _headers file that allows only the staging API", () => {
    const csp = connectSrc(readHeaders("headers/staging/_headers"));
    expect(csp).toContain("https://staging-api.kissmetgroup.org");
    expect(csp).not.toContain("https://api.kissmetgroup.org");
  });

  it("apply-staging-headers writes the staging CSP into the build output", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "kissmet-staging-headers-"));
    const dest = path.join(outDir, "_headers");
    execFileSync(process.execPath, [path.join(root, "scripts", "apply-staging-headers.mjs"), dest], { cwd: root });
    const csp = connectSrc(fs.readFileSync(dest, "utf8"));
    expect(csp).toContain("https://staging-api.kissmetgroup.org");
    expect(csp).not.toContain("https://api.kissmetgroup.org");
  });
});
