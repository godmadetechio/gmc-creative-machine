import Link from "next/link";
import { Plus, Pencil, ExternalLink } from "lucide-react";
import { ClientSchema } from "@gmc/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { ClientDialog } from "./client-dialog";

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

export default async function ClientsPage() {
  const supabase = await createClient();
  const [{ data, error }, pendingCandidatesResult, draftCreativesResult] =
    await Promise.all([
      supabase.from("clients").select("*").order("created_at", { ascending: false }),
      supabase.from("ad_candidates").select("client_id").eq("status", "candidate"),
      supabase.from("creatives").select("client_id").eq("status", "draft"),
    ]);

  const clients = (data ?? []).map((row) => ClientSchema.parse(row));
  const countByClient = (rows: { client_id: string }[] | null) => {
    const map = new Map<string, number>();
    for (const row of rows ?? []) {
      map.set(row.client_id, (map.get(row.client_id) ?? 0) + 1);
    }
    return map;
  };
  const pendingByClient = countByClient(pendingCandidatesResult.data);
  const draftsByClient = countByClient(draftCreativesResult.data);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clients</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Every pipeline starts here — onboard a client, then run Buyer
            Brain.
          </p>
        </div>
        <ClientDialog
          trigger={
            <Button>
              <Plus />
              New client
            </Button>
          }
        />
      </div>

      {error ? (
        <Card className="mt-8">
          <CardContent className="text-destructive py-12 text-center text-sm">
            Failed to load clients: {error.message}
          </CardContent>
        </Card>
      ) : clients.length === 0 ? (
        <Card className="mt-8">
          <CardContent className="text-muted-foreground py-12 text-center text-sm">
            No clients yet. Create your first client to unlock the pipelines.
          </CardContent>
        </Card>
      ) : (
        <Card className="mt-8 py-2">
          <CardContent className="px-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Name</TableHead>
                  <TableHead>Niche</TableHead>
                  <TableHead>Pending review</TableHead>
                  <TableHead>Website</TableHead>
                  <TableHead>Drive</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell className="pl-4 font-medium">
                      <Link
                        href={`/clients/${client.id}`}
                        className="hover:underline"
                      >
                        {client.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-56 truncate">
                      {client.niche ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(pendingByClient.get(client.id) ?? 0) > 0 && (
                          <Badge asChild variant="secondary">
                            <Link href={`/clients/${client.id}?tab=selection`}>
                              {pendingByClient.get(client.id)} candidates
                            </Link>
                          </Badge>
                        )}
                        {(draftsByClient.get(client.id) ?? 0) > 0 && (
                          <Badge asChild variant="secondary">
                            <Link href={`/clients/${client.id}?tab=creatives`}>
                              {draftsByClient.get(client.id)} creatives
                            </Link>
                          </Badge>
                        )}
                        {(pendingByClient.get(client.id) ?? 0) === 0 &&
                          (draftsByClient.get(client.id) ?? 0) === 0 && (
                            <span className="text-muted-foreground">—</span>
                          )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {client.website ? (
                        <a
                          href={client.website}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                        >
                          {new URL(client.website).hostname}
                          <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {client.drive_folder_id ? "Linked" : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {dateFormat.format(new Date(client.created_at))}
                    </TableCell>
                    <TableCell>
                      <ClientDialog
                        client={client}
                        trigger={
                          <Button variant="ghost" size="icon">
                            <Pencil />
                            <span className="sr-only">
                              Edit {client.name}
                            </span>
                          </Button>
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
