export type RoleCode = "super_admin" | "manager" | "reception" | "accounts" | "maintenance" | "resident";

export const rolePermissions: Record<RoleCode, string[]> = {
  super_admin: ["*"],
  manager: ["admin:read", "admin:write", "resident:read", "resident:write", "application:read", "application:write", "booking:read", "booking:write", "booking:confirm", "allocation:read", "allocation:write", "payment:read", "payment:write", "payment:verify", "receipt:read", "receipt:write", "document:read", "document:write", "document:ghana_card", "maintenance:read", "maintenance:create", "maintenance:assign", "maintenance:update", "maintenance:resolve", "maintenance:close", "announcement:read", "announcement:write", "announcement:publish", "announcement:external_delivery", "message:read", "message:write", "message:send", "message:external_delivery", "report:read", "report:finance", "staff:read", "audit:read"],
  reception: ["admin:read", "resident:read", "resident:write", "application:read", "application:write", "booking:read", "booking:write", "allocation:read", "allocation:write", "payment:read", "payment:write", "document:read", "document:write", "maintenance:read", "maintenance:create", "maintenance:assign", "announcement:read", "message:read", "message:write", "message:send", "report:read"],
  accounts: ["booking:read", "booking:confirm", "payment:read", "payment:write", "payment:verify", "receipt:read", "receipt:write", "message:read", "message:write", "message:send", "report:read", "report:finance"],
  maintenance: ["maintenance:read", "maintenance:update", "maintenance:resolve", "message:read", "message:write", "message:send", "report:read"],
  resident: ["resident:self"]
};

export function hasRole(role: RoleCode | null, allowed: RoleCode[]): boolean {
  return Boolean(role && allowed.includes(role));
}

export function hasPermission(role: RoleCode | null, permission: string): boolean {
  if (!role) return false;
  const permissions = rolePermissions[role] ?? [];
  return permissions.includes("*") || permissions.includes(permission);
}
