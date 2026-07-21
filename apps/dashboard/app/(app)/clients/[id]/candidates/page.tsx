import { redirect } from "next/navigation";

// The candidates queue lives on the client page's Selection tab now; this
// stub keeps old links (and their filters) working.
export default async function CandidatesRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ superseded?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams({ tab: "selection" });
  if (sp.superseded === "1") qs.set("superseded", "1");
  redirect(`/clients/${id}?${qs}`);
}
