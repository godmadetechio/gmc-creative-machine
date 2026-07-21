"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BriefSectionsSchema, SeedVertical } from "@gmc/shared";
import { createDirectiveVersion, type DirectiveTarget } from "@/lib/directives";
import { createClient } from "@/lib/supabase/server";

export type DirectiveActionState =
  | { status: "error"; message: string }
  | { status: "success"; version: number }
  | null;

const SaveInputSchema = z.object({
  scope: z.enum(["agency", "vertical", "client"]),
  vertical: z
    .string()
    .transform((v) => (v === "" ? null : v))
    .pipe(SeedVertical.nullable()),
  client_id: z
    .string()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.string().uuid().nullable()),
  /** BriefSections serialized by the editor. */
  sections_json: z.string(),
});

export async function saveDirective(
  _prevState: DirectiveActionState,
  formData: FormData,
): Promise<DirectiveActionState> {
  const parsed = SaveInputSchema.safeParse({
    scope: formData.get("scope"),
    vertical: formData.get("vertical") ?? "",
    client_id: formData.get("client_id") ?? "",
    sections_json: formData.get("sections_json"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid input" };
  }
  const { scope, vertical, client_id, sections_json } = parsed.data;

  let target: DirectiveTarget;
  if (scope === "agency") {
    target = { scope };
  } else if (scope === "vertical") {
    if (!vertical) return { status: "error", message: "Vertical is required" };
    target = { scope, vertical };
  } else {
    if (!client_id) return { status: "error", message: "Client is required" };
    target = { scope, clientId: client_id };
  }

  let rawSections: unknown;
  try {
    rawSections = JSON.parse(sections_json);
  } catch {
    return { status: "error", message: "Malformed sections payload" };
  }
  const sections = BriefSectionsSchema.safeParse(rawSections);
  if (!sections.success) {
    return {
      status: "error",
      message: sections.error.issues[0]?.message ?? "Invalid sections",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const result = await createDirectiveVersion(
    supabase,
    target,
    sections.data,
    user?.email ?? null,
  );
  if ("error" in result) {
    return { status: "error", message: result.error };
  }

  revalidatePath("/direction");
  if (client_id) {
    revalidatePath(`/clients/${client_id}`);
    revalidatePath(`/clients/${client_id}`);
  }
  return { status: "success", version: result.version };
}
