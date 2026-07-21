"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Users,
  Play,
  ClipboardCheck,
  LayoutTemplate,
  GalleryHorizontalEnd,
  Compass,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/runs", label: "Runs", icon: Play },
  { href: "/review", label: "Review", icon: ClipboardCheck },
  { href: "/formats", label: "Formats", icon: LayoutTemplate },
  { href: "/swipe-file", label: "Swipe File", icon: GalleryHorizontalEnd },
  { href: "/direction", label: "Direction", icon: Compass },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
