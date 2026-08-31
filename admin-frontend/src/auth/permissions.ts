import type { RoleCode } from "../types/api";

const rolePermissions: Record<RoleCode, string[]> = {
  super_admin: ["*"],
  manager: ["admin:read", "admin:write", "resident:read", "resident:write", "application:read", "application:write", "booking:read", "booking:write", "booking:confirm", "allocation:read", "allocation:write", "payment:read", "payment:write", "payment:verify", "receipt:read", "receipt:write", "document:read", "document:write", "document:ghana_card", "maintenance:read", "maintenance:create", "maintenance:assign", "maintenance:update", "maintenance:resolve", "maintenance:close", "announcement:read", "announcement:write", "announcement:publish", "announcement:external_delivery", "audit:read"],
  reception: ["admin:read", "resident:read", "resident:write", "application:read", "application:write", "booking:read", "booking:write", "allocation:read", "allocation:write", "payment:read", "payment:write", "document:read", "document:write", "maintenance:read", "maintenance:create", "maintenance:assign", "announcement:read"],
  accounts: ["booking:read", "booking:confirm", "payment:read", "payment:write", "payment:verify", "receipt:read", "receipt:write"],
  maintenance: ["maintenance:read", "maintenance:update", "maintenance:resolve"],
  resident: ["resident:self"]
};

export function hasPermission(role: RoleCode | null | undefined, permission: string) {
  if (!role) return false;
  const permissions = rolePermissions[role] ?? [];
  return permissions.includes("*") || permissions.includes(permission);
}
