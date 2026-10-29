import Link from "next/link";
import { cookies } from "next/headers";
import PageHeader from "@/components/PageHeader";
import ExportBuilder from "@/components/ExportBuilder";
import { mayExport } from "@/lib/admin";
import { SESSION_COOKIE, authDisabled, isGuest, readSession, verifySession } from "@/lib/auth";
import { FILTER_KEYS } from "@/lib/exportColumns";
import { param } from "@/lib/urlState";

export const dynamic = "force-dynamic";

/** Export page: pick the rows and columns, see the data, download Excel / PDF / CSV / Word. */
export default async function ExportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = authDisabled() ? "local" : await verifySession(token);
  const allowed = await mayExport(user);
  // Guests: only the pages they may open.
  const pages = user && isGuest(user) && !authDisabled() ? (await readSession(token))?.pages ?? [] : null;
  const canTrials = !pages || pages.includes("trials");
  const canDrugs = !pages || pages.includes("drugs");
  const wanted = param(sp.type) === "drugs" ? "drugs" : "trials";
  const dataset = wanted === "drugs" ? (canDrugs ? "drugs" : "trials") : (canTrials ? "trials" : "drugs");
  const filters = Object.fromEntries(FILTER_KEYS[dataset].map((k) => [k, param(sp[k]).slice(0, 200)]).filter(([, v]) => v));

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Export"
        title="Download"
        highlight="data"
        description="Choose the rows and the columns you need, check them below, then download as Excel, PDF, CSV or Word."
      />
      {!allowed || (!canTrials && !canDrugs) ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          <b className="font-semibold">Downloading data isn&apos;t switched on for your login.</b> Ask an admin to tick
          &ldquo;Can download data&rdquo; for you on the Admin page. <Link href="/" className="text-brand-700 underline">Back to the overview</Link>
        </div>
      ) : (
        <ExportBuilder initialDataset={dataset} filters={filters as Record<string, string>} canTrials={canTrials} canDrugs={canDrugs} />
      )}
    </div>
  );
}
