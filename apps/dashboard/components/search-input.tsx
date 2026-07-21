"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

// Debounced ?q= search box: replaces the URL (preserving every other param)
// and resets pagination. Server components re-filter on navigation.
export function SearchInput({
  paramKey = "q",
  pageKey = "page",
  placeholder = "Search…",
}: {
  paramKey?: string;
  pageKey?: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get(paramKey) ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (next.trim()) params.set(paramKey, next.trim());
      else params.delete(paramKey);
      params.delete(pageKey);
      router.replace(`${pathname}${params.size > 0 ? `?${params}` : ""}`, {
        scroll: false,
      });
    }, 300);
  }

  return (
    <div className="relative w-full max-w-56">
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 pl-8 text-sm"
        aria-label={placeholder}
      />
    </div>
  );
}
