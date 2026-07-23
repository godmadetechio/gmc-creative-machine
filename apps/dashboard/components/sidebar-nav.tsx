"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Users,
  Play,
  ClipboardCheck,
  Wallet,
  LayoutTemplate,
  GalleryHorizontalEnd,
  Compass,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV_GROUPS: { heading: string | null; items: NavItem[] }[] = [
  {
    heading: "Operations",
    items: [
      { href: "/clients", label: "Clients", icon: Users },
      { href: "/runs", label: "Runs", icon: Play },
      { href: "/review", label: "Review", icon: ClipboardCheck },
      { href: "/usage", label: "Usage", icon: Wallet },
    ],
  },
  {
    heading: "Library",
    items: [
      { href: "/formats", label: "Formats", icon: LayoutTemplate },
      { href: "/swipe-file", label: "Swipe File", icon: GalleryHorizontalEnd },
      { href: "/direction", label: "Direction", icon: Compass },
    ],
  },
  {
    heading: null,
    items: [{ href: "/settings", label: "Settings", icon: Settings }],
  },
];

export function SidebarNav({ reviewCount = 0 }: { reviewCount?: number }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-4">
      {NAV_GROUPS.map((group, i) => (
        <div key={group.heading ?? i} className="flex flex-col gap-1">
          {group.heading && (
            <p className="text-muted-foreground px-3 text-[11px] font-medium tracking-wider uppercase">
              {group.heading}
            </p>
          )}
          {group.items.map(({ href, label, icon: Icon }) => {
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
                <span className="flex-1">{label}</span>
                {href === "/review" && reviewCount > 0 && (
                  <Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
                    {reviewCount > 99 ? "99+" : reviewCount}
                  </Badge>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
