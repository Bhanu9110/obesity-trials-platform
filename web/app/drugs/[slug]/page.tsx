import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE, authDisabled, isGuest, verifySession } from "@/lib/auth";
import { notFound } from "next/navigation";
import { getProduct, getProductTrials, productNames } from "@/lib/queries";
import { highestPhase } from "@/lib/format";
import ProductInfoCard from "@/components/ProductInfoCard";
import MergeProduct from "@/components/MergeProduct";
import DrugTrialsTable from "@/components/DrugTrialsTable";

export const dynamic = "force-dynamic";

export default async function DrugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProduct(decodeURIComponent(slug));
  if (!product) notFound();
  const [trials, names] = await Promise.all([getProductTrials(product.id), productNames()]);
  const primary = trials.filter((t) => t.obesity_class === "primary");
  const viewOnly = !authDisabled() && isGuest(await verifySession((await cookies()).get(SESSION_COOKIE)?.value));

  return (
    <div className="space-y-4">
      <Link href="/drugs" className="text-sm text-brand-600 hover:underline">
        ← All drugs
      </Link>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h1 className="text-xl font-semibold text-slate-900">{product.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {primary.length.toLocaleString()} primary-obesity trial{primary.length === 1 ? "" : "s"}
          {trials.length > primary.length && <> (+{trials.length - primary.length} other stored)</>}
          {primary.length > 0 && <> · most advanced: {highestPhase(primary.map((t) => t.phase))}</>}
        </p>
      </div>

      <ProductInfoCard product={product} readOnly={viewOnly} />

      <DrugTrialsTable trials={trials} />

      {!viewOnly && <MergeProduct slug={product.slug} name={product.name} options={names} />}
    </div>
  );
}
