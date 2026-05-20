import { Suspense } from "react";
import { DashboardShell } from "./shell";

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardShell />
    </Suspense>
  );
}

function DashboardSkeleton() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <p className="text-ink/40 text-sm">Loading your balance…</p>
    </div>
  );
}
