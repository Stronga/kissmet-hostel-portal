/**
 * Resolves VITE_API_BASE_URL for the Kissmet frontends.
 *
 * Development and test keep a localhost fallback when the variable is unset.
 * Production (vite build default mode, and runtime when MODE is production)
 * refuses missing, empty, non-absolute, non-https, or loopback values.
 */
export const DEV_API_BASE_URL_FALLBACK = "http://localhost:8787";

export class InvalidApiBaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidApiBaseUrlError";
  }
}

const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (LOOPBACK_HOSTS.has(host) || LOOPBACK_HOSTS.has(hostname.toLowerCase())) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.startsWith("127.")) return true; // 127.0.0.0/8
  return false;
}


/** Split an absolute URL without depending on the DOM `URL` constructor (resident `tsconfig.node` has no DOM lib). */
export function parseAbsoluteUrl(raw: string): { protocol: string; hostname: string } | null {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]+)/.exec(raw);
  if (!match) return null;
  const protocol = `${match[1].toLowerCase()}:`;
  let host = match[2];
  const at = host.lastIndexOf("@");
  if (at !== -1) host = host.slice(at + 1);
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end === -1) return null;
    return { protocol, hostname: host.slice(0, end + 1) };
  }
  const colon = host.indexOf(":");
  const hostname = colon === -1 ? host : host.slice(0, colon);
  if (!hostname) return null;
  return { protocol, hostname };
}

function productionFailure(reason: string): never {
  throw new InvalidApiBaseUrlError(
    `VITE_API_BASE_URL ${reason} Production builds and runtime require an absolute https URL that is not localhost, 127.0.0.1, or another loopback address.`,
  );
}

/** True when Vite mode is production (the default for `vite build`). */
export function isProductionMode(mode: string | undefined): boolean {
  return mode === "production";
}

/**
 * @param value - raw `VITE_API_BASE_URL` (may be undefined or whitespace)
 * @param mode - Vite `MODE` (`development`, `test`, `production`, ...)
 */
export function resolveApiBaseUrl(value: string | undefined, mode: string | undefined): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const production = isProductionMode(mode);

  if (!production) {
    return raw || DEV_API_BASE_URL_FALLBACK;
  }

  if (!raw) {
    productionFailure("is missing or empty.");
  }

  const parsed = parseAbsoluteUrl(raw);
  if (!parsed) {
    productionFailure("is not a valid absolute URL.");
  }

  if (parsed.protocol !== "https:") {
    productionFailure("must use the https: protocol (http is not allowed).");
  }

  if (isLoopbackHost(parsed.hostname)) {
    productionFailure("must not point at a loopback host.");
  }

  return raw;
}

type ViteGuardConfig = {
  command: "build" | "serve";
  mode: string;
  env: Record<string, string>;
};

/**
 * Vite plugin that fails a production build when VITE_API_BASE_URL is invalid.
 * Development and preview/serve are not blocked so local work keeps the fallback.
 */
export function viteApiBaseUrlGuard(): {
  name: string;
  configResolved: (config: ViteGuardConfig) => void;
} {
  return {
    name: "vite-api-base-url-guard",
    configResolved(config) {
      if (config.command !== "build" || !isProductionMode(config.mode)) return;
      resolveApiBaseUrl(config.env.VITE_API_BASE_URL, "production");
    },
  };
}
