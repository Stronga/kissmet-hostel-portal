import { readFileSync } from "node:fs";
import { checkServerIdentity, type ConnectionOptions, type PeerCertificate } from "node:tls";
import type { ConnectorConfig } from "../config.js";

/**
 * Build Node TLS options for the RouterOS api-ssl connection (node-routeros passes them to
 * `tls.connect(port, host, options)`).
 *
 * Security model:
 * - Certificate chain is ALWAYS verified (`rejectUnauthorized: true`) against the configured CA
 *   bundle (normally the RouterOS local CA exported to the Pi). The system trust store is not
 *   used, so a public CA cannot vouch for the router.
 * - Hostname/IP is checked against MIKROTIK_API_TLS_SERVERNAME (default MIKROTIK_HOST) unless a
 *   SHA-256 pin is configured, in which case the pin is authoritative and must match exactly.
 * - Lab-only MIKROTIK_API_TLS_INSECURE_SKIP_VERIFY disables verification; loadConfig refuses it
 *   in production and this function refuses it again as defence in depth.
 * - TLS 1.2 minimum.
 *
 * Returns `undefined` when TLS is disabled (plain API on 8728, explicitly non-production only).
 * Never logs or returns certificate contents or secrets.
 */
export function buildRouterOsTlsOptions(
  config: ConnectorConfig,
  readFile: (path: string) => Buffer | string = (p) => readFileSync(p)
): ConnectionOptions | undefined {
  if (!config.mikrotikApiTls) {
    // Defence in depth: loadConfig already refuses plaintext in production.
    if (config.mode === "production" && config.routerosDriver === "real") {
      throw new Error("Plaintext RouterOS API is not allowed in production; set MIKROTIK_API_TLS=true");
    }
    return undefined;
  }

  if (config.mikrotikApiTlsInsecure) {
    if (config.mode === "production") {
      throw new Error("Insecure RouterOS TLS is not allowed in production");
    }
    return { rejectUnauthorized: false, minVersion: "TLSv1.2" };
  }

  if (!config.mikrotikApiTlsCaFile) {
    throw new Error("MIKROTIK_API_TLS_CA_FILE is required when MIKROTIK_API_TLS=true");
  }
  let ca: Buffer | string;
  try {
    ca = readFile(config.mikrotikApiTlsCaFile);
  } catch {
    throw new Error("MIKROTIK_API_TLS_CA_FILE could not be read");
  }
  if (!String(ca).includes("-----BEGIN CERTIFICATE-----")) {
    throw new Error("MIKROTIK_API_TLS_CA_FILE must contain a PEM certificate");
  }

  const servername = config.mikrotikApiTlsServername ?? config.mikrotikHost;
  const pin = config.mikrotikApiTlsFingerprint256;

  return {
    ca,
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
    // SNI must be a DNS name; RFC 6066 forbids IP literals.
    ...(isIpLiteral(servername) ? {} : { servername }),
    checkServerIdentity: (_host: string, cert: PeerCertificate) => verifyRouterOsPeer(servername, cert, pin)
  };
}

/** Exported for tests. Returns an Error to reject, undefined to accept (Node checkServerIdentity contract). */
export function verifyRouterOsPeer(servername: string, cert: PeerCertificate, pin?: string): Error | undefined {
  if (pin) {
    const actual = (cert.fingerprint256 ?? "").toUpperCase();
    if (actual !== pin) {
      return new Error("RouterOS certificate fingerprint does not match MIKROTIK_API_TLS_FINGERPRINT256");
    }
    return undefined;
  }
  return checkServerIdentity(servername, cert);
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}
