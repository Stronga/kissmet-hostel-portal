import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(root, "..");
const src = join(frontendRoot, "headers", "staging", "_headers");
const dest = resolve(process.argv[2] ?? join(frontendRoot, "dist", "_headers"));
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
