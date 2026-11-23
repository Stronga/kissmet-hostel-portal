#!/usr/bin/env node
/**
 * Staging synthetic seed wrapper.
 *
 * Generates (and, only with explicit --apply --confirm kissmet-hostel-staging, would apply)
 * obviously fake hostel reference data for the isolated staging D1 database.
 *
 * Safety:
 * - Never targets production (--env production is refused; --confirm kissmet-production is refused).
 * - Never reads seeds/development.sql.
 * - Never contacts the Raspberry Pi, the real MikroTik, or any connector.
 * - Default is a dry run (SQL only). Do not pass --apply without owner approval.
 * - Requires the staging D1 database_id in wrangler.toml to be a real id, not the placeholder
 *   (the underlying bootstrap already refuses apply while the id is a placeholder).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "./bootstrap-production.mjs";

const USAGE = `Usage:
  node scripts/seed-staging-synthetic.mjs [--env staging] [--config bootstrap/staging.synthetic.config.json]
        [--out bootstrap/staging.bootstrap.sql] [--issue-admin-temp-password]
        [--apply --confirm kissmet-hostel-staging]

Default is a dry run. --apply requires owner approval, a real staging D1 id, and
--confirm kissmet-hostel-staging. Never use this against kissmet-production.`;

function hasFlag(args, name) {
  return args.includes(name);
}

function valueAfter(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) return undefined;
  return v;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function seedStagingMain(argv, deps) {
  if (hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    const stdout = deps?.stdout ?? ((s) => process.stdout.write(s));
    stdout(`${USAGE}\n`);
    return 0;
  }
  const env = valueAfter(argv, "--env") ?? "staging";
  if (env === "production") {
    const stderr = deps?.stderr ?? ((s) => process.stderr.write(s));
    stderr("Refusing: synthetic seed cannot run with --env production\n");
    return 2;
  }
  const confirm = valueAfter(argv, "--confirm");
  if (confirm === "kissmet-production") {
    const stderr = deps?.stderr ?? ((s) => process.stderr.write(s));
    stderr("Refusing: synthetic seed cannot be applied to kissmet-production\n");
    return 2;
  }

  const args = [...argv];
  if (!hasFlag(args, "--env")) args.push("--env", "staging");
  if (!hasFlag(args, "--synthetic")) args.push("--synthetic");
  if (!hasFlag(args, "--config")) args.push("--config", "bootstrap/staging.synthetic.config.json");
  return main(args, deps);
}

if (invokedDirectly) {
  seedStagingMain(process.argv.slice(2)).then((code) => process.exit(code));
}
