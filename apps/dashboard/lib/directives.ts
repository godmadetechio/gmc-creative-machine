import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BriefSectionsSchema,
  compileDirection,
  CreativeDirectiveSchema,
  renderDirectionMarkdown,
  type BriefSections,
  type CompiledDirection,
  type CreativeDirective,
  type SeedVertical,
} from "@gmc/shared";

// Versioned-write helper shared by the Direction editors and the
// accept-suggestion flow: new versions are new rows, the old active row is
// deactivated, history is never mutated.

export type DirectiveTarget =
  | { scope: "agency" }
  | { scope: "vertical"; vertical: SeedVertical }
  | { scope: "client"; clientId: string };

// Equality filters identifying one scope-target, for .match().
function targetMatch(target: DirectiveTarget): Record<string, string> {
  if (target.scope === "vertical") {
    return { scope: "vertical", vertical: target.vertical };
  }
  if (target.scope === "client") {
    return { scope: "client", client_id: target.clientId };
  }
  return { scope: "agency" };
}

export async function loadActiveDirective(
  supabase: SupabaseClient,
  target: DirectiveTarget,
): Promise<CreativeDirective | null> {
  const { data, error } = await supabase
    .from("creative_directives")
    .select("*")
    .match(targetMatch(target))
    .eq("is_active", true)
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] ? CreativeDirectiveSchema.parse(data[0]) : null;
}

// The compiled preview: same compile + render pair the worker uses, so the
// preview is byte-identical to what generation agents read.
export async function getCompiledPreview(
  supabase: SupabaseClient,
  clientId: string,
  vertical: SeedVertical,
): Promise<{ text: string; compiled: CompiledDirection }> {
  const { data, error } = await supabase
    .from("creative_directives")
    .select("*")
    .eq("is_active", true)
    .or(
      `scope.eq.agency,and(scope.eq.vertical,vertical.eq.${vertical}),and(scope.eq.client,client_id.eq.${clientId})`,
    );
  if (error) throw new Error(error.message);
  const compiled = compileDirection(
    (data ?? []).map((row) => CreativeDirectiveSchema.parse(row)),
  );

  const referenceLabels = new Map<string, string>();
  if (compiled.reference_ids.length > 0) {
    const { data: refs } = await supabase
      .from("reference_library")
      .select("id, title")
      .in("id", compiled.reference_ids);
    for (const ref of refs ?? []) referenceLabels.set(ref.id, ref.title);
  }

  return { text: renderDirectionMarkdown(compiled, { referenceLabels }), compiled };
}

export async function createDirectiveVersion(
  supabase: SupabaseClient,
  target: DirectiveTarget,
  sections: BriefSections,
  author: string | null,
): Promise<{ version: number } | { error: string }> {
  const parsed = BriefSectionsSchema.safeParse(sections);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid sections" };
  }

  const { data: latestRows, error: latestError } = await supabase
    .from("creative_directives")
    .select("id, version, is_active")
    .match(targetMatch(target))
    .order("version", { ascending: false })
    .limit(1);
  if (latestError) return { error: latestError.message };
  const latest = latestRows?.[0] ?? null;
  const nextVersion = (latest?.version ?? 0) + 1;

  // Deactivate-then-insert (partial unique index allows one active row per
  // target). Single-operator app: the narrow window between the two writes
  // is acceptable; a failed insert leaves the target brief-less rather than
  // double-active, and the next save self-heals.
  if (latest?.is_active) {
    const { error: deactivateError } = await supabase
      .from("creative_directives")
      .update({ is_active: false })
      .eq("id", latest.id);
    if (deactivateError) return { error: deactivateError.message };
  }

  const { error: insertError } = await supabase.from("creative_directives").insert({
    scope: target.scope,
    vertical: target.scope === "vertical" ? target.vertical : null,
    client_id: target.scope === "client" ? target.clientId : null,
    version: nextVersion,
    is_active: true,
    author,
    sections: parsed.data,
  });
  if (insertError) return { error: insertError.message };

  return { version: nextVersion };
}
