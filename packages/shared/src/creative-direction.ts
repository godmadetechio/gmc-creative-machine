import { z } from "zod";
import { SeedVertical } from "./enums";

// CREATIVE DIRECTION — layered standing briefs (agency / vertical / client)
// every generation agent must obey. compileDirection/renderDirectionMarkdown
// are pure and shared so the dashboard "Compiled preview" and the worker
// produce byte-identical text: the preview IS what agents read.

export const DirectiveScope = z.enum(["agency", "vertical", "client"]);
export type DirectiveScope = z.infer<typeof DirectiveScope>;

export const HardRulesSchema = z.object({
  never: z.array(z.string().trim().min(1)).default([]),
  always: z.array(z.string().trim().min(1)).default([]),
});
export type HardRules = z.infer<typeof HardRulesSchema>;

// All sections optional — a brief says only what it needs to say.
export const BriefSectionsSchema = z.object({
  objective: z.string().optional(),
  tone_voice: z.string().optional(),
  visual_direction: z.string().optional(),
  /** Ordered — first item matters most. */
  messaging_priorities: z.array(z.string()).optional(),
  hard_rules: HardRulesSchema.optional(),
  /** Linked swipe-file references (reference_library ids). */
  reference_ids: z.array(z.string().uuid()).optional(),
  compliance_notes: z.string().optional(),
  current_focus: z.string().optional(),
});
export type BriefSections = z.infer<typeof BriefSectionsSchema>;

/** BriefSections keys that hold plain text, in render order. */
export const SCALAR_SECTIONS = [
  "objective",
  "tone_voice",
  "visual_direction",
  "compliance_notes",
  "current_focus",
] as const;
export type ScalarSection = (typeof SCALAR_SECTIONS)[number];

export const SECTION_LABELS: Record<keyof BriefSections, string> = {
  objective: "Objective",
  tone_voice: "Tone & voice",
  visual_direction: "Visual direction",
  messaging_priorities: "Messaging priorities",
  hard_rules: "Hard rules",
  reference_ids: "References",
  compliance_notes: "Compliance notes",
  current_focus: "Current focus",
};

// A creative_directives row as read from the DB.
export const CreativeDirectiveSchema = z.object({
  id: z.string().uuid(),
  scope: DirectiveScope,
  vertical: SeedVertical.nullable(),
  client_id: z.string().uuid().nullable(),
  version: z.number().int().min(1),
  is_active: z.boolean(),
  author: z.string().nullable(),
  // catch({}) so one malformed historical row can't crash every page.
  sections: BriefSectionsSchema.catch({}),
  created_at: z.string(),
});
export type CreativeDirective = z.infer<typeof CreativeDirectiveSchema>;

export type CompiledDirection = {
  /** scope -> version actually applied (also stored on creatives.directives_used). */
  sources: Partial<Record<DirectiveScope, number>>;
  /** Winning value per scalar section, with the scope it came from. */
  scalars: Partial<Record<ScalarSection, { value: string; scope: DirectiveScope }>>;
  messaging_priorities: { value: string[]; scope: DirectiveScope } | null;
  /** UNION across scopes — a 'never' at any level always applies. */
  hard_rules: HardRules;
  /** UNION across scopes — directive references are standing orders. */
  reference_ids: string[];
};

const PRECEDENCE: DirectiveScope[] = ["agency", "vertical", "client"];

// Merge active briefs. Scalars + messaging_priorities: highest-precedence
// non-empty wins (client > vertical > agency). hard_rules/reference_ids:
// union in precedence order, deduped.
export function compileDirection(directives: CreativeDirective[]): CompiledDirection {
  const ordered = PRECEDENCE.map((scope) =>
    directives.find((d) => d.scope === scope),
  ).filter((d): d is CreativeDirective => !!d);

  const compiled: CompiledDirection = {
    sources: {},
    scalars: {},
    messaging_priorities: null,
    hard_rules: { never: [], always: [] },
    reference_ids: [],
  };

  const pushUnique = (list: string[], items: string[]) => {
    for (const item of items) {
      const trimmed = item.trim();
      if (trimmed && !list.some((x) => x.toLowerCase() === trimmed.toLowerCase())) {
        list.push(trimmed);
      }
    }
  };

  // Iterated lowest→highest precedence so later scopes overwrite scalars.
  for (const directive of ordered) {
    compiled.sources[directive.scope] = directive.version;
    const sections = directive.sections;
    for (const key of SCALAR_SECTIONS) {
      const value = sections[key]?.trim();
      if (value) compiled.scalars[key] = { value, scope: directive.scope };
    }
    if (sections.messaging_priorities?.length) {
      compiled.messaging_priorities = {
        value: sections.messaging_priorities,
        scope: directive.scope,
      };
    }
    if (sections.hard_rules) {
      pushUnique(compiled.hard_rules.never, sections.hard_rules.never);
      pushUnique(compiled.hard_rules.always, sections.hard_rules.always);
    }
    if (sections.reference_ids?.length) {
      pushUnique(compiled.reference_ids, sections.reference_ids);
    }
  }

  return compiled;
}

const scopeLabel = (scope: DirectiveScope, sources: CompiledDirection["sources"]) =>
  `${scope} brief v${sources[scope]}`;

// The exact text generation agents read (and the dashboard previews).
// referenceLabels resolves reference ids to human labels; unresolved ids
// render as bare ids so a stale link is visible rather than silent.
export function renderDirectionMarkdown(
  compiled: CompiledDirection,
  opts: { referenceLabels?: Map<string, string> } = {},
): string {
  const lines: string[] = [];
  const attribution = (scope: DirectiveScope) =>
    ` _(${scopeLabel(scope, compiled.sources)})_`;

  for (const key of ["objective", "tone_voice", "visual_direction"] as const) {
    const section = compiled.scalars[key];
    if (section) {
      lines.push(`**${SECTION_LABELS[key]}**${attribution(section.scope)}`);
      lines.push(section.value, "");
    }
  }
  if (compiled.messaging_priorities) {
    lines.push(
      `**${SECTION_LABELS.messaging_priorities}** (in order)${attribution(compiled.messaging_priorities.scope)}`,
    );
    compiled.messaging_priorities.value.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
    lines.push("");
  }
  if (compiled.hard_rules.never.length + compiled.hard_rules.always.length > 0) {
    lines.push("**Hard rules** (absolute — union of every brief level)");
    for (const rule of compiled.hard_rules.never) lines.push(`- NEVER: ${rule}`);
    for (const rule of compiled.hard_rules.always) lines.push(`- ALWAYS: ${rule}`);
    lines.push("");
  }
  const compliance = compiled.scalars.compliance_notes;
  if (compliance) {
    lines.push(`**${SECTION_LABELS.compliance_notes}**${attribution(compliance.scope)}`);
    lines.push(compliance.value, "");
  }
  const focus = compiled.scalars.current_focus;
  if (focus) {
    lines.push(`**${SECTION_LABELS.current_focus}**${attribution(focus.scope)}`);
    lines.push(focus.value, "");
  }
  if (compiled.reference_ids.length > 0) {
    lines.push("**Directive references** (agency-mandated style references — available in the asset manifest by id)");
    for (const id of compiled.reference_ids) {
      const label = opts.referenceLabels?.get(id);
      lines.push(label ? `- ${label} (asset id: ${id})` : `- asset id: ${id}`);
    }
    lines.push("");
  }

  return lines.length > 0
    ? lines.join("\n").trim()
    : "No creative direction set yet.";
}

// ── Feedback-to-brief suggestions ─────────────────────────────────────────

export const SuggestionKind = z.enum(["add_never", "add_always", "amend_section"]);
export type SuggestionKind = z.infer<typeof SuggestionKind>;

export const SuggestionStatus = z.enum(["pending", "accepted", "dismissed"]);
export type SuggestionStatus = z.infer<typeof SuggestionStatus>;

/** Sections amend_section may target (rule adds always target hard_rules). */
export const AMENDABLE_SECTIONS = [
  "objective",
  "tone_voice",
  "visual_direction",
  "compliance_notes",
  "current_focus",
] as const;

// Suggester-agent output. Quotes are re-verified in code against the real
// feedback rows — an invented quote drops the suggestion.
export const BriefSuggesterOutputSchema = z.object({
  suggestions: z
    .array(
      z.object({
        kind: SuggestionKind,
        section: z.enum(["hard_rules", ...AMENDABLE_SECTIONS]),
        /** The rule text (add_*) or full replacement section text (amend). */
        proposal: z.string().min(5),
        rationale: z.string().min(10),
        feedback_quotes: z.array(z.string().min(3)).min(1).max(5),
      }),
    )
    .max(8),
});
export type BriefSuggesterOutput = z.infer<typeof BriefSuggesterOutputSchema>;

// A brief_suggestions row as read from the DB.
export const BriefSuggestionSchema = z.object({
  id: z.string().uuid(),
  client_id: z.string().uuid(),
  run_id: z.string().uuid().nullable(),
  section: z.string(),
  kind: SuggestionKind,
  proposal: z.object({ text: z.string() }),
  rationale: z.string().nullable(),
  feedback_quotes: z.array(z.string()),
  status: SuggestionStatus,
  created_at: z.string(),
});
export type BriefSuggestion = z.infer<typeof BriefSuggestionSchema>;

// Accepting a suggestion = one amendment applied to the current sections
// (one new brief version per acceptance — traceability over tidy numbers).
// Pure so the dashboard accept action and any future automation agree.
export function applySuggestion(
  sections: BriefSections,
  suggestion: { kind: SuggestionKind; section: string; proposal: { text: string } },
): BriefSections {
  // JSON round-trip clone: this package compiles against pure ES2022
  // (no DOM/Node globals, so no structuredClone); sections are plain JSON.
  const next: BriefSections = JSON.parse(JSON.stringify(sections));
  const text = suggestion.proposal.text.trim();
  if (suggestion.kind === "add_never" || suggestion.kind === "add_always") {
    const rules = (next.hard_rules ??= { never: [], always: [] });
    const list = suggestion.kind === "add_never" ? rules.never : rules.always;
    if (!list.some((r) => r.toLowerCase() === text.toLowerCase())) list.push(text);
    return next;
  }
  const key = suggestion.section as (typeof AMENDABLE_SECTIONS)[number];
  if ((AMENDABLE_SECTIONS as readonly string[]).includes(key)) {
    next[key] = text;
  }
  return next;
}
