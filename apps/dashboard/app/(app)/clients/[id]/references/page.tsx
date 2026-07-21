import { redirect } from "next/navigation";

// The references picker lives on the client page's Assets tab now.
export default async function ReferencesRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/clients/${id}?tab=assets`);
}
