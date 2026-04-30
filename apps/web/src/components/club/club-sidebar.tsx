"use client";

import type React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Building2, Users, Settings, Palette, CreditCard } from "lucide-react";
import { useClubOrg } from "@/context/club-org-context";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
};

const baseNavItems: NavItem[] = [
  { href: "/dashboard/club", label: "Overview", icon: BarChart3, exact: true },
  { href: "/dashboard/club/teams", label: "Teams", icon: Building2 },
  { href: "/dashboard/club/members", label: "Members", icon: Users },
  { href: "/dashboard/club/settings", label: "Settings", icon: Settings },
];

const ownerOnlyNavItems: NavItem[] = [
  { href: "/dashboard/club/branding", label: "Branding", icon: Palette },
  { href: "/dashboard/club/billing", label: "Billing", icon: CreditCard },
];

export function ClubSidebar() {
  const pathname = usePathname();
  const { orgName, orgRole } = useClubOrg();

  const navItems =
    orgRole === "owner"
      ? [...baseNavItems, ...ownerOnlyNavItems]
      : baseNavItems;

  return (
    <aside className="w-48 shrink-0">
      <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">
        {orgName}
      </p>
      <nav className="space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
