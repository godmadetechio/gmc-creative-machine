import { Card, CardContent } from "@/components/ui/card";

export default function ReviewPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Review</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Ad candidate and creative review queues.
      </p>
      <Card className="mt-8">
        <CardContent className="text-muted-foreground py-12 text-center text-sm">
          Nothing to review yet — the selection and creative review queues
          arrive in Phase 2.
        </CardContent>
      </Card>
    </div>
  );
}
