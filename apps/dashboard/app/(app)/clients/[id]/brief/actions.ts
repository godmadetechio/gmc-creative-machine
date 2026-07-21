"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { applySuggestion, BriefSuggestionSchema } from "@gmc/shared";
import { createDirectiveVersion, loadActiveDirective } from "@/lib/directives";
import { createClient } from "@/lib/supabase/server";

export type BriefActionState =
  | { status: "error"; message: string }
  | { status: "success" }
  | null;

const EnqueueInputSchema = z.object({ client_id: z.string().uuid() });

export async function enqueueBriefSuggestions(
  _prevState: BriefActionState,
  formData: FormData,
): Promise<BriefActionState> {
  const parsed = EnqueueInputSchema.safeParse({
    client_id: formData.get("client_id"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid input" };
  }
  const { client_id } = parsed.data;

  const supabase = await createClient();
  const { data: active, error: activeError } = await supabase
    .from("runs")
    .select("id")
    .eq("client_id", client_id)
    .eq("type", "brief_suggestions")
    .in("status", ["queued", "running"])
    .limit(1);
  if (activeError) {
    return { status: "error", message: activeError.message };
  }
  if (active && active.length > 0) {
    return {
      status: "error",
      message: "A suggestion run is already queued or running for this client.",
    };
  }

  const { error } = await supabase.from("runs").insert({
    client_id,
    type: "brief_suggestions",
    status: "queued",
    input_json: {},
  });
  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath(`/clients/${client_id}/brief`);
  revalidatePath("/runs");
  return { status: "success" };
}

const SuggestionInputSchema = z.object({
  suggestion_id: z.string().uuid(),
  client_id: z.string().uuid(),
});

// Accept = apply this ONE amendment to the current client sections and cut
// a new brief version (one version per acceptance — traceability over tidy
// version numbers). Nothing auto-applies without this click.
export async function acceptSuggestion(
  _prevState: BriefActionState,
  formData: FormData,
): Promise<BriefActionState> {
  const parsed = SuggestionInputSchema.safeParse({
    suggestion_id: formData.get("suggestion_id"),
    client_id: formData.get("client_id"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid input" };
  }
  const { suggestion_id, client_id } = parsed.data;

  const supabase = await createClient();
  const { data: row, error: fetchError } = await supabase
    .from("brief_suggestions")
    .select("*")
    .eq("id", suggestion_id)
    .eq("client_id", client_id)
    .eq("status", "pending")
    .maybeSingle();
  if (fetchError) {
    return { status: "error", message: fetchError.message };
  }
  if (!row) {
    return { status: "error", message: "Suggestion not found or already handled" };
  }
  const suggestion = BriefSuggestionSchema.parse(row);

  const current = await loadActiveDirective(supabase, {
    scope: "client",
    clientId: client_id,
  });
  const nextSections = applySuggestion(current?.sections ?? {}, suggestion);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const result = await createDirectiveVersion(
    supabase,
    { scope: "client", clientId: client_id },
    nextSections,
    `${user?.email ?? "operator"} (accepted suggestion)`,
  );
  if ("error" in result) {
    return { status: "error", message: result.error };
  }

  const { error: statusError } = await supabase
    .from("brief_suggestions")
    .update({ status: "accepted" })
    .eq("id", suggestion_id);
  if (statusError) {
    return {
      status: "error",
      message: `Brief v${result.version} created, but failed to mark the suggestion: ${statusError.message}`,
    };
  }

  revalidatePath(`/clients/${client_id}/brief`);
  revalidatePath(`/clients/${client_id}`);
  revalidatePath("/direction");
  return { status: "success" };
}

export async function dismissSuggestion(
  _prevState: BriefActionState,
  formData: FormData,
): Promise<BriefActionState> {
  const parsed = SuggestionInputSchema.safeParse({
    suggestion_id: formData.get("suggestion_id"),
    client_id: formData.get("client_id"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("brief_suggestions")
    .update({ status: "dismissed" })
    .eq("id", parsed.data.suggestion_id)
    .eq("status", "pending");
  if (error) {
    return { status: "error", message: error.message };
  }

  revalidatePath(`/clients/${parsed.data.client_id}/brief`);
  return { status: "success" };
}
