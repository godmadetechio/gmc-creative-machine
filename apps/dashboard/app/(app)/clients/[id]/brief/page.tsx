import { redirect } from "next/navigation";

// The client creative brief lives on the client page's Brief tab now.
export default async function BriefRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/clients/${id}?tab=brief`);
}
