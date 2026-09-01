import { Bell, CreditCard, FileText, Home, Inbox, LifeBuoy, LogOut, User, Wrench, KeyRound } from "lucide-react";

export const primaryNavItems = [
  { label: "Home", href: "/home", icon: Home },
  { label: "Application", href: "/application", icon: FileText },
  { label: "Payments", href: "/payments", icon: CreditCard },
  { label: "My Room", href: "/room", icon: KeyRound }
] as const;

export const moreNavItems = [
  { label: "Booking", href: "/booking", icon: FileText },
  { label: "Maintenance", href: "/maintenance", icon: Wrench },
  { label: "Messages", href: "/messages", icon: Inbox },
  { label: "Announcements", href: "/announcements", icon: Bell },
  { label: "Profile", href: "/profile", icon: User },
  { label: "Documents", href: "/documents", icon: LifeBuoy }
] as const;

export const allNavItems = [...primaryNavItems, ...moreNavItems] as const;

export const portalTitle = "Kissmet Resident Portal";
