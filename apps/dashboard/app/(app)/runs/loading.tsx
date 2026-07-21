import { Skeleton } from "@/components/ui/skeleton";

export default function RunsLoading() {
  return (
    <div>
      <Skeleton className="h-8 w-32" />
      <Skeleton className="mt-2 h-4 w-72" />
      <Skeleton className="mt-6 h-96 w-full" />
    </div>
  );
}
