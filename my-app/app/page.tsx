import { redirect } from "next/navigation";
import { getLatestRfxOverview } from "@/lib/db/queries/getRfxOverview";

export default async function Home() {
  const rfx = await getLatestRfxOverview();
  if (rfx) redirect(`/rfx/${rfx.id}`);

  return (
    <div className="mx-auto max-w-xl p-8">
      <h1 className="text-xl font-semibold mb-2">No RFx found</h1>
      <p className="text-sm text-muted-foreground">
        Run <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[0.9em]">npm run seed</code> and{" "}
        <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[0.9em]">npm run seed:vendors</code> to
        create the demo dataset.
      </p>
    </div>
  );
}
