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
          Ad candidate review lives on each client&apos;s page (Creative
          Selection → Review candidates), and the creative review queue at
          Still Ads → Review creatives.
        </CardContent>
      </Card>
    </div>
  );
}
