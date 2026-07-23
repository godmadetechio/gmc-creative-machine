import { redirect } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { LowBalanceBanner } from "@/components/low-balance-banner";
import { SidebarNav } from "@/components/sidebar-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { WorkerStatusBanner } from "@/components/worker-status-banner";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Review badge = things a human must click on. The app is fully dynamic
  // (cookies), so this re-renders on every navigation and revalidatePath —
  // fresh enough without polling.
  const [pendingCandidates, draftCreatives] = await Promise.all([
    supabase
      .from("ad_candidates")
      .select("id", { count: "exact", head: true })
      .eq("status", "candidate"),
    supabase
      .from("creatives")
      .select("id", { count: "exact", head: true })
      .eq("status", "draft"),
  ]);
  const reviewCount =
    (pendingCandidates.count ?? 0) + (draftCreatives.count ?? 0);

  return (
    <div className="flex min-h-screen">
      <aside className="bg-sidebar border-sidebar-border fixed inset-y-0 left-0 flex w-56 flex-col border-r">
        <div className="px-5 py-5">
          <span className="text-lg font-bold tracking-tight">GODMADE</span>
          <p className="text-muted-foreground text-xs">Client Machine</p>
        </div>
        <Separator />
        <div className="flex-1 overflow-y-auto p-3">
          <SidebarNav reviewCount={reviewCount} />
        </div>
        <Separator />
        <div className="p-3">
          <p className="text-muted-foreground truncate px-3 pb-1 text-xs">
            {user.email}
          </p>
          <SignOutButton />
        </div>
      </aside>
      <div className="ml-56 flex flex-1 flex-col">
        <WorkerStatusBanner />
        <LowBalanceBanner />
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
