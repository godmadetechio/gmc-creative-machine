import { Skeleton } from "@/components/ui/skeleton";
import { TabSkeleton } from "./tab-skeleton";

export default function ClientLoading() {
  return (
    <div>
      <Skeleton className="h-4 w-24" />
      <div className="mt-3 flex flex-col gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="mt-5 h-10 w-[480px] max-w-full rounded-lg" />
      <TabSkeleton />
    </div>
  );
}
