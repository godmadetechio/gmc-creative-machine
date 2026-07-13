import { Card, CardContent } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        API keys, integrations, and pipeline defaults.
      </p>
      <Card className="mt-8">
        <CardContent className="text-muted-foreground py-12 text-center text-sm">
          No settings yet — integration configuration arrives with the
          pipelines (Phases 1–5). Keys live in .env.local for now.
        </CardContent>
      </Card>
    </div>
  );
}
