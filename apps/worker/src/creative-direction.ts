import type { SupabaseClient } from "@supabase/supabase-js";
import {
  compileDirection,
  CreativeDirectiveSchema,
  REFERENCE_LIBRARY_BUCKET,
  ReferenceLibraryEntrySchema,
  renderDirectionMarkdown,
  type CompiledDirection,
  type DirectiveScope,
  type SeedVertical,
} from "@gmc/shared";
import type { ManifestAsset } from "./asset-library";

// Creative Direction access for the generation pipelines: merges the
// active agency + vertical + client briefs (client > vertical > agency,
// hard_rules/reference_ids union) into the CREATIVE DIRECTION block the
// concept agent and image compiler read, and resolves directive-linked
// swipe-file references so agents can actually cite them.

const SIGNED_URL_TTL_SECONDS = 6 * 60 * 60;

export type CreativeDirection = {
  /** Rendered markdown — byte-identical to the dashboard Compiled preview. */
  text: string;
  /** scope -> version, stored on creatives.directives_used. */
  versionsUsed: Partial<Record<DirectiveScope, number>>;
  compiled: CompiledDirection;
  /** Directive-linked references as style-pool entries (standing orders —
   * merged into the manifest whether or not the client picked them). */
  references: ManifestAsset[];
  warnings: string[];
};

export async function getCreativeDirection(
  supabase: SupabaseClient,
  clientId: string,
  vertical: SeedVertical,
): Promise<CreativeDirection> {
  const warnings: string[] = [];

  const { data: rows, error } = await supabase
    .from("creative_directives")
    .select("*")
    .eq("is_active", true)
    .or(
      `scope.eq.agency,and(scope.eq.vertical,vertical.eq.${vertical}),and(scope.eq.client,client_id.eq.${clientId})`,
    );
  if (error) throw new Error(`Failed to load creative directives: ${error.message}`);
  const directives = (rows ?? []).map((row) => CreativeDirectiveSchema.parse(row));

  const compiled = compileDirection(directives);

  // Resolve directive references: active swipe-file entries with signed
  // URLs, shaped like the picked-reference manifest entries so the still-ads
  // pipeline can merge them into the same style pool / id space.
  const references: ManifestAsset[] = [];
  const referenceLabels = new Map<string, string>();
  if (compiled.reference_ids.length > 0) {
    const { data: refRows, error: refError } = await supabase
      .from("reference_library")
      .select("*")
      .in("id", compiled.reference_ids);
    if (refError) {
      warnings.push(`failed to load directive references: ${refError.message}`);
    } else {
      const byId = new Map(
        (refRows ?? []).map((row) => {
          const parsed = ReferenceLibraryEntrySchema.parse(row);
          return [parsed.id, parsed] as const;
        }),
      );
      const usable = compiled.reference_ids
        .map((id) => byId.get(id))
        .filter((r): r is NonNullable<typeof r> => !!r && r.status === "active");
      for (const id of compiled.reference_ids) {
        const ref = byId.get(id);
        if (!ref) warnings.push(`directive references missing swipe-file entry ${id}`);
        else if (ref.status !== "active") {
          warnings.push(`directive reference "${ref.title}" is ${ref.status} — skipped`);
        }
      }

      const { data: signed, error: signError } =
        usable.length > 0
          ? await supabase.storage
              .from(REFERENCE_LIBRARY_BUCKET)
              .createSignedUrls(
                usable.map((r) => r.storage_path),
                SIGNED_URL_TTL_SECONDS,
              )
          : { data: [], error: null };
      if (signError) {
        warnings.push(`failed to sign directive reference URLs: ${signError.message}`);
      }
      const urlByPath = new Map(
        (signed ?? [])
          .filter((s) => s.path && s.signedUrl)
          .map((s) => [s.path!, s.signedUrl]),
      );

      for (const ref of usable) {
        referenceLabels.set(ref.id, ref.title);
        const source =
          ref.annotation_source === "ai" ? "ai-noted" : "human-noted";
        references.push({
          id: ref.id,
          client_id: clientId,
          kind: "inspiration_ad",
          bucket: REFERENCE_LIBRARY_BUCKET,
          storage_path: ref.storage_path,
          drive_file_id: null,
          notes: [
            `[swipe file · directive · ${source}] ${ref.title}`,
            ref.notes,
            ref.format_name ? `exemplifies format: ${ref.format_name}` : null,
          ]
            .filter((part): part is string => !!part)
            .join(" · "),
          tags: ref.tags,
          source_candidate_id: null,
          created_at: ref.created_at,
          url: urlByPath.get(ref.storage_path) ?? null,
          from_swipe_file: true,
        });
      }
    }
  }

  return {
    text: renderDirectionMarkdown(compiled, { referenceLabels }),
    versionsUsed: compiled.sources,
    compiled,
    references,
    warnings,
  };
}
