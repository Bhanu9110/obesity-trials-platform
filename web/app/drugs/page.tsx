import { listProducts } from "@/lib/queries";
import DrugsTable from "@/components/DrugsTable";

export const dynamic = "force-dynamic";

export default async function DrugsPage() {
  const products = await listProducts();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Drugs</h1>
        <p className="text-sm text-slate-500">
          Every drug found in the trial interventions. Open one to fill in its product information
          and see all of its trials.
        </p>
      </div>
      <DrugsTable products={products} />
    </div>
  );
}
