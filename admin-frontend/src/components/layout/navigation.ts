import { BarChart3, BedDouble, Bell, BookOpenCheck, Building2, ClipboardList, CreditCard, FileText, LayoutDashboard, ReceiptText, Settings, ShieldCheck, Users, Wrench } from "lucide-react";
import type { ComponentType } from "react";
import type { RoleCode } from "../../types/api";

export interface NavItem {
  label: string;
  to: string;
  icon: ComponentType<{ className?: string }>;
  roles?: RoleCode[];
}

export const navGroups: { label: string; items: NavItem[] }[] = [
  { label: "Overview", items: [{ label: "Dashboard", to: "/dashboard", icon: LayoutDashboard }] },
  { label: "Residents", items: [
    { label: "Residents", to: "/residents", icon: Users },
    { label: "Applications", to: "/applications", icon: ClipboardList },
    { label: "Bookings", to: "/bookings", icon: BookOpenCheck }
  ] },
  { label: "Rooms", items: [
    { label: "Rooms & Beds", to: "/rooms", icon: BedDouble },
    { label: "Allocations", to: "/allocations", icon: Building2 }
  ] },
  { label: "Finance", items: [
    { label: "Payments", to: "/payments", icon: CreditCard, roles: ["super_admin", "manager", "accounts"] },
    { label: "Receipts", to: "/receipts", icon: ReceiptText, roles: ["super_admin", "manager", "accounts"] }
  ] },
  { label: "Operations", items: [
    { label: "Maintenance", to: "/maintenance", icon: Wrench },
    { label: "Announcements", to: "/announcements", icon: Bell, roles: ["super_admin", "manager", "reception"] },
    { label: "Reports", to: "/reports", icon: BarChart3 }
  ] },
  { label: "Administration", items: [
    { label: "Staff", to: "/staff", icon: ShieldCheck, roles: ["super_admin", "manager"] },
    { label: "Audit Logs", to: "/audit-logs", icon: FileText, roles: ["super_admin", "manager"] },
    { label: "Settings", to: "/settings", icon: Settings, roles: ["super_admin", "manager"] }
  ] }
];
