import { listProducts } from "@/lib/queries";
import PageHeader from "@/components/PageHeader";
import DrugsExplorer from "@/components/DrugsExplorer";

export const dynamic = "force-dynamic";

export default async function DrugsPage() {
  const products = await listProducts();
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Drug intelligence"
        title="Obesity drugs"
        highlight="pipeline"
        description="Every drug found in obesity trial interventions, with how far each has progressed. Open one for its profile, charts and every trial."
      />
      <DrugsExplorer products={products} />
    </div>
  );
}
