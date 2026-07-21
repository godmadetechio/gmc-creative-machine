import { redirect } from "next/navigation";

// The creatives review grid lives on the client page's Creatives tab now;
// this stub keeps old links (and their filters) working.
export default async function CreativesRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ avatar?: string; framework?: string; status?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams({ tab: "creatives" });
  for (const key of ["avatar", "framework", "status"] as const) {
    if (sp[key]) qs.set(key, sp[key]);
  }
  redirect(`/clients/${id}?${qs}`);
}
