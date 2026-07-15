import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FormatLibraryEntrySchema,
  type FormatLibraryEntry,
  type SeedVertical,
} from "@gmc/shared";

// The agency-level format library (AI_ADS_TRAINING_INTEGRATION.md §2a).
// This module owns seeding from prompts/static-frameworks.md and the
// read API that Phase 3/4 concept agents consume.

const FRAMEWORKS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "prompts",
  "static-frameworks.md",
);

export type SeedFormat = {
  name: string;
  description: string;
  psychology: string;
  skeleton: string;
};

// Parses the fixed ## / **Description:** / **Psychology:** / **Skeleton:**
// structure of static-frameworks.md. Throws on drift so a broken edit to the
// file fails the scan loudly instead of silently seeding garbage.
export function parseStaticFrameworks(md: string): SeedFormat[] {
  const sections = md.split(/^## /m).slice(1);
  const formats = sections.map((section) => {
    const [nameLine, ...rest] = section.split("\n");
    const name = (nameLine ?? "").trim();
    const body = rest.join("\n");
    const grab = (field: string): string => {
      const re = new RegExp(
        `\\*\\*${field}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\*\\*|$)`,
      );
      const match = body.match(re);
      const value = match?.[1]?.trim() ?? "";
      if (!value) {
        throw new Error(
          `static-frameworks.md: format "${name}" is missing **${field}:**`,
        );
      }
      return value;
    };
    return {
      name,
      description: grab("Description"),
      psychology: grab("Psychology"),
      skeleton: grab("Skeleton"),
    };
  });
  if (formats.length < 10) {
    throw new Error(
      `static-frameworks.md: expected at least 10 formats, found ${formats.length}`,
    );
  }
  return formats;
}

// Seeds format_library from static-frameworks.md when the table is empty,
// so scan #1 enriches known formats rather than inventing the library.
// Returns the number of rows inserted (0 = already seeded). Idempotent:
// the unique index on lower(name) rejects duplicates even under a race.
export async function seedLibraryIfEmpty(
  supabase: SupabaseClient,
): Promise<number> {
  const { count, error: countError } = await supabase
    .from("format_library")
    .select("id", { count: "exact", head: true });
  if (countError) {
    throw new Error(`format_library count failed: ${countError.message}`);
  }
  if ((count ?? 0) > 0) return 0;

  const seeds = parseStaticFrameworks(readFileSync(FRAMEWORKS_PATH, "utf8"));
  const { error } = await supabase.from("format_library").insert(
    seeds.map((s) => ({
      name: s.name,
      description: s.description,
      psychology: s.psychology,
      skeleton: s.skeleton,
      status: "active",
      // Seeded formats have no confirmation yet — last_confirmed stays null
      // until a scan actually sees them in the wild.
    })),
  );
  if (error) {
    throw new Error(`format_library seed failed: ${error.message}`);
  }
  return seeds.length;
}

export type FormatWithProvenance = FormatLibraryEntry & {
  /** Set only when getFormatLibrary is called with a vertical. */
  provenance?: "proven_in_vertical" | "cross_vertical_import";
};

// Integration hook for Phases 3/4: active formats with examples, freshest
// first. With a vertical, each format is flagged as proven in that vertical
// or a cross-vertical import (seen elsewhere — worth testing here).
export async function getFormatLibrary(
  supabase: SupabaseClient,
  opts: { vertical?: SeedVertical } = {},
): Promise<FormatWithProvenance[]> {
  const { data, error } = await supabase
    .from("format_library")
    .select("*")
    .eq("status", "active")
    .order("last_confirmed", { ascending: false, nullsFirst: false });
  if (error) {
    throw new Error(`format_library read failed: ${error.message}`);
  }
  const formats = (data ?? []).map((row) => FormatLibraryEntrySchema.parse(row));
  if (!opts.vertical) return formats;
  return formats.map((f) => ({
    ...f,
    provenance: f.verticals_seen.includes(opts.vertical!)
      ? ("proven_in_vertical" as const)
      : ("cross_vertical_import" as const),
  }));
}
