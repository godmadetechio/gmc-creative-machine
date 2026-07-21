import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

// Review hub: everything across all clients that's waiting on a human,
// deep-linked into the client tabs where the actual review happens.

export default async function ReviewPage() {
  const supabase = await createClient();
  const [clientsResult, pendingCandidatesResult, draftCreativesResult] =
    await Promise.all([
      supabase.from("clients").select("id, name").order("name"),
      supabase.from("ad_candidates").select("client_id").eq("status", "candidate"),
      supabase.from("creatives").select("client_id").eq("status", "draft"),
    ]);

  const countByClient = (rows: { client_id: string }[] | null) => {
    const map = new Map<string, number>();
    for (const row of rows ?? []) {
      map.set(row.client_id, (map.get(row.client_id) ?? 0) + 1);
    }
    return map;
  };
  const pendingByClient = countByClient(pendingCandidatesResult.data);
  const draftsByClient = countByClient(draftCreativesResult.data);

  const rows = (clientsResult.data ?? [])
    .map((client) => ({
      ...client,
      candidates: pendingByClient.get(client.id) ?? 0,
      creatives: draftsByClient.get(client.id) ?? 0,
    }))
    .filter((row) => row.candidates > 0 || row.creatives > 0)
    .sort((a, b) => b.candidates + b.creatives - (a.candidates + a.creatives));

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Review</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Everything waiting on a human, across all clients — candidates to
        select, creatives to approve.
      </p>

      {rows.length === 0 ? (
        <Card className="mt-8">
          <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-12 text-center text-sm">
            <ClipboardCheck className="size-6" />
            All caught up — nothing pending review.
          </CardContent>
        </Card>
      ) : (
        <Card className="mt-8 py-2">
          <CardContent className="px-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Client</TableHead>
                  <TableHead>Ad candidates</TableHead>
                  <TableHead>Draft creatives</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="pl-4 font-medium">
                      <Link href={`/clients/${row.id}`} className="hover:underline">
                        {row.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {row.candidates > 0 ? (
                        <Badge asChild variant="secondary">
                          <Link href={`/clients/${row.id}?tab=selection`}>
                            {row.candidates} to select
                          </Link>
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.creatives > 0 ? (
                        <Badge asChild variant="secondary">
                          <Link href={`/clients/${row.id}?tab=creatives`}>
                            {row.creatives} to approve
                          </Link>
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
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
