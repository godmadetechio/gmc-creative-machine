import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, ExternalLink, Pencil } from "lucide-react";
import { z } from "zod";
import { ClientSchema } from "@gmc/shared";
import { Button } from "@/components/ui/button";
import { RunWatcher } from "@/components/run-watcher";
import { createClient } from "@/lib/supabase/server";
import { ClientDialog } from "../client-dialog";
import {
  ClientTabs,
  parseClientTab,
  type ClientTabCounts,
} from "./client-tabs";
import { TabSkeleton } from "./tab-skeleton";
import { AssetsTab } from "./tabs/assets-tab";
import { BriefTab } from "./tabs/brief-tab";
import { CreativesTab } from "./tabs/creatives-tab";
import { OverviewTab } from "./tabs/overview-tab";
import { ResearchTab } from "./tabs/research-tab";
import { SelectionTab } from "./tabs/selection-tab";

// Tab shell: awaits only the client row + cheap head-count queries (tab
// label badges + refresh condition), then streams the active tab's async
// section behind Suspense so tab switches feel instant.

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const tab = parseClientTab(sp.tab);

  const supabase = await createClient();
  const [
    clientResult,
    pendingCandidatesResult,
    draftCreativesResult,
    openRequestsResult,
    pendingSuggestionsResult,
    activeRunsResult,
  ] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("ad_candidates")
      .select("id", { count: "exact", head: true })
      .eq("client_id", id)
      .eq("status", "candidate"),
    supabase
      .from("creatives")
      .select("id", { count: "exact", head: true })
      .eq("client_id", id)
      .eq("status", "draft"),
    supabase
      .from("asset_requests")
      .select("id", { count: "exact", head: true })
      .eq("client_id", id)
      .eq("status", "open"),
    supabase
      .from("brief_suggestions")
      .select("id", { count: "exact", head: true })
      .eq("client_id", id)
      .eq("status", "pending"),
    supabase
      .from("runs")
      .select("id", { count: "exact", head: true })
      .eq("client_id", id)
      .in("status", ["queued", "running"]),
  ]);

  if (!clientResult.data) notFound();
  const client = ClientSchema.parse(clientResult.data);
  const counts: ClientTabCounts = {
    pendingCandidates: pendingCandidatesResult.count ?? 0,
    draftCreatives: draftCreativesResult.count ?? 0,
    openAssetRequests: openRequestsResult.count ?? 0,
    pendingSuggestions: pendingSuggestionsResult.count ?? 0,
  };
  const hasActiveRun = (activeRunsResult.count ?? 0) > 0;

  const tabContent = {
    overview: <OverviewTab client={client} />,
    research: <ResearchTab client={client} searchParams={sp} />,
    selection: <SelectionTab client={client} searchParams={sp} />,
    creatives: <CreativesTab client={client} searchParams={sp} />,
    assets: <AssetsTab client={client} searchParams={sp} />,
    brief: <BriefTab client={client} />,
  }[tab];

  return (
    <div>
      <RunWatcher clientId={client.id} active={hasActiveRun} />

      <Link
        href="/clients"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-3.5" />
        All clients
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{client.name}</h1>
            <ClientDialog
              client={client}
              trigger={
                <Button variant="ghost" size="icon">
                  <Pencil />
                  <span className="sr-only">Edit {client.name}</span>
                </Button>
              }
            />
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {client.niche ?? "No niche set"}
            {client.website && (
              <>
                {" · "}
                <a
                  href={client.website}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-foreground inline-flex items-center gap-1"
                >
                  {new URL(client.website).hostname}
                  <ExternalLink className="size-3" />
                </a>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="mt-5">
        <ClientTabs clientId={client.id} active={tab} counts={counts} />
      </div>

      <Suspense key={tab} fallback={<TabSkeleton />}>
        {tabContent}
      </Suspense>
    </div>
  );
}
