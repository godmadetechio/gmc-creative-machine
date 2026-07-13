"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <Button
      variant="ghost"
      className="text-muted-foreground w-full justify-start gap-3"
      onClick={signOut}
    >
      <LogOut className="size-4" />
      Sign out
    </Button>
  );
}
