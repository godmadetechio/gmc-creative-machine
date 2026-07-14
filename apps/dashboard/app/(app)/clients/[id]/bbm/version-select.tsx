"use client";

import { usePathname, useRouter } from "next/navigation";

export function VersionSelect({
  versions,
  selected,
}: {
  versions: { version: number; is_active: boolean; created_at: string }[];
  selected: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

  return (
    <select
      value={selected}
      onChange={(e) => router.push(`${pathname}?v=${e.target.value}`)}
      className="border-input bg-background h-9 rounded-md border px-2 text-sm"
      aria-label="BBM version"
    >
      {versions.map((v) => (
        <option key={v.version} value={v.version}>
          v{v.version} — {dateFormat.format(new Date(v.created_at))}
          {v.is_active ? " (active)" : ""}
        </option>
      ))}
    </select>
  );
}
