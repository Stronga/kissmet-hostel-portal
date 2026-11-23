import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viteBin = path.join(root, "node_modules/.bin/vite");

function runProductionBuild(env: NodeJS.ProcessEnv) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "kissmet-api-base-guard-"));
  const result = spawnSync(viteBin, ["build", "--outDir", outDir, "--emptyOutDir"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { result, outDir };
}

describe("production vite build guard", () => {
  it("refuses a production build when VITE_API_BASE_URL is unset", () => {
    const { result } = runProductionBuild({
      VITE_API_BASE_URL: "",
      NODE_ENV: "production",
    });
    expect(result.status).not.toBe(0);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain("VITE_API_BASE_URL");
  });

  it("refuses a production build when VITE_API_BASE_URL is http localhost", () => {
    const { result } = runProductionBuild({
      VITE_API_BASE_URL: "http://localhost:8787",
      NODE_ENV: "production",
    });
    expect(result.status).not.toBe(0);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain("VITE_API_BASE_URL");
  });

  it("succeeds a production build with an absolute https API URL", () => {
    const { result, outDir } = runProductionBuild({
      VITE_API_BASE_URL: "https://api.kissmetgroup.org",
      NODE_ENV: "production",
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(fs.existsSync(path.join(outDir, "index.html"))).toBe(true);
  });
});
