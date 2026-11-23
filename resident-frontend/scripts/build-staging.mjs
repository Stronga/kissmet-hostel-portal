import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env, VITE_API_BASE_URL: "https://staging-api.kissmetgroup.org" };
const build = spawnSync("npm", ["run", "build"], {
  cwd: frontendRoot,
  stdio: "inherit",
  env,
  shell: true
});
process.exit(build.status ?? 1);
