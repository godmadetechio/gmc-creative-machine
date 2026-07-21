import { redirect } from "next/navigation";

// The Asset Library lives on the client page's Assets tab now.
export default async function AssetsRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/clients/${id}?tab=assets`);
}
