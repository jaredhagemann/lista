"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AVAILABILITY_WINDOWS, type AvailabilityWindow } from "@/lib/availability-window";

/**
 * Chooses which events the matrix covers (BUG-014). Plain links, so the server
 * fetches exactly the window being shown rather than everything ever.
 */
export function AvailabilityWindowTabs({ active }: { active: AvailabilityWindow }) {
  const pathname = usePathname();

  return (
    <div className="flex items-center rounded-md border p-0.5 gap-0.5">
      {AVAILABILITY_WINDOWS.map((option) => (
        <Link
          key={option.value}
          href={option.value === "upcoming" ? pathname : `${pathname}?window=${option.value}`}
          scroll={false}
          className={`rounded px-3 py-1 text-sm transition-colors ${
            active === option.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
        </Link>
      ))}
    </div>
  );
}
