import { redirect } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { SidebarNav } from "@/components/sidebar-nav";
import { SignOutButton } from "@/components/sign-out-button";
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

  return (
    <div className="flex min-h-screen">
      <aside className="bg-sidebar border-sidebar-border fixed inset-y-0 left-0 flex w-56 flex-col border-r">
        <div className="px-5 py-5">
          <span className="text-lg font-bold tracking-tight">GODMADE</span>
          <p className="text-muted-foreground text-xs">Client Machine</p>
        </div>
        <Separator />
        <div className="flex-1 overflow-y-auto p-3">
          <SidebarNav />
        </div>
        <Separator />
        <div className="p-3">
          <p className="text-muted-foreground truncate px-3 pb-1 text-xs">
            {user.email}
          </p>
          <SignOutButton />
        </div>
      </aside>
      <main className="ml-56 flex-1 p-8">{children}</main>
    </div>
  );
}
