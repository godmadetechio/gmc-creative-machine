import { Plus, Pencil, ExternalLink } from "lucide-react";
import { ClientSchema } from "@gmc/shared";
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
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("created_at", { ascending: false });

  const clients = (data ?? []).map((row) => ClientSchema.parse(row));

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
                      {client.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-56 truncate">
                      {client.niche ?? "—"}
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
