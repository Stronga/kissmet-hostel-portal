import type { Context, Next } from "hono";
import type { Env } from "../types/bindings";
import { sha256Hex } from "../auth/crypto";
import { AuthRepository } from "../repositories/auth.repository";
import type { AuthUser } from "../auth/context";
import { hasPermission, hasRole, type RoleCode } from "../auth/permissions";

type Variables = { authUser: AuthUser };

function bearerToken(c: Context): string | null {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

export async function requireAuth(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  return makeRequireAuth()(c, next);
}

export function makeRequireAuth(repoFactory?: (db: Env["DB"]) => AuthRepository) {
  return async (c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) => {
  const token = bearerToken(c);
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  const tokenHash = await sha256Hex(token);
  const repo = repoFactory ? repoFactory(c.env.DB) : new AuthRepository(c.env.DB);
  const session = await repo.findSessionByTokenHash(tokenHash);
  if (!session || session.session_status !== "active" || session.user_status !== "active") {
    return c.json({ error: "Unauthorized" }, 401);
  }

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await repo.revokeSession(tokenHash, "expired");
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Staff sessions must still map to an active staff row (defense in depth beyond revocation).
  if (session.user_type === "staff" && session.staff_status !== "active") {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Keep resident and staff session identities separated at the auth boundary.
  if (session.user_type === "resident" && !session.resident_id) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (session.user_type === "staff" && !session.staff_id) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("authUser", {
    id: session.user_id,
    userType: session.user_type,
    displayName: session.display_name,
    email: session.email,
    role: (session.user_type === "resident" ? "resident" : session.role_code) as RoleCode,
    staffId: session.user_type === "staff" ? session.staff_id : null,
    residentId: session.user_type === "resident" ? session.resident_id : null,
    sessionId: session.session_id
  });

  return next();
  };
}

export function requireRole(...roles: RoleCode[]) {
  return async (c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) => {
    const user = c.get("authUser");
    if (!hasRole(user?.role ?? null, roles)) return c.json({ error: "Forbidden" }, 403);
    return next();
  };
}

export function requirePermission(permission: string) {
  return async (c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) => {
    const user = c.get("authUser");
    if (!hasPermission(user?.role ?? null, permission)) return c.json({ error: "Forbidden" }, 403);
    return next();
  };
}

/** Resident portal routes: authenticated resident sessions only. */
export function requireResident() {
  return async (c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) => {
    const user = c.get("authUser");
    if (!user || user.userType !== "resident" || user.role !== "resident" || !user.residentId) {
      return c.json({ error: "Forbidden" }, 403);
    }
    return next();
  };
}

/** Admin API routes: authenticated staff sessions only (residents never cross this boundary). */
export function requireStaff() {
  return async (c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) => {
    const user = c.get("authUser");
    if (!user || user.userType !== "staff" || !user.staffId || user.role === "resident") {
      return c.json({ error: "Forbidden" }, 403);
    }
    return next();
  };
}
