"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Product, ProductInfo } from "@/lib/types";

// Suggestions only — every field accepts free text.
const SUGGEST: Partial<Record<keyof ProductInfo, string[]>> = {
  modality: [
    "Small molecule", "Peptide", "Monoclonal antibody", "Protein / biologic",
    "Oligonucleotide (siRNA / ASO)", "Gene therapy", "Cell therapy", "Fixed-dose combination",
  ],
  phase: [
    "Preclinical", "Phase 1", "Phase 1/2", "Phase 2", "Phase 2/3", "Phase 3",
    "Registration / Filed", "Approved", "Discontinued",
  ],
  roa: ["Oral", "Subcutaneous", "Intravenous", "Intramuscular", "Intranasal", "Transdermal", "Topical"],
  drug_class: [
    "GLP-1 receptor agonist", "GLP-1/GIP dual agonist", "GLP-1/glucagon dual agonist",
    "GLP-1/GIP/glucagon triple agonist", "Amylin analogue", "Amylin/GLP-1 dual agonist",
    "Oral small-molecule GLP-1 RA", "MC4R agonist", "Lipase inhibitor", "Sympathomimetic amine",
    "Activin type II receptor antibody", "CB1 receptor antagonist", "SGLT2 inhibitor", "Biguanide",
  ],
};

const FIELDS: { key: keyof ProductInfo; label: string; wide?: boolean }[] = [
  { key: "modality", label: "Modality" },
  { key: "phase", label: "Phase" },
  { key: "moa", label: "MOA (mechanism of action)", wide: true },
  { key: "roa", label: "ROA (route of administration)" },
  { key: "approved", label: "Approved" },
  { key: "approval_date", label: "Approval date" },
  { key: "sponsor", label: "Sponsor" },
  { key: "drug_class", label: "Class" },
];

function toForm(p: Product): Record<keyof ProductInfo, string> {
  return {
    modality: p.modality ?? "", phase: p.phase ?? "", moa: p.moa ?? "", roa: p.roa ?? "",
    approved: p.approved ?? "", approval_date: p.approval_date ?? "", sponsor: p.sponsor ?? "",
    drug_class: p.drug_class ?? "",
  };
}

function display(p: Product, key: keyof ProductInfo): string | null {
  const v = p[key];
  if (!v) return null;
  if (key === "approval_date") {
    const d = new Date(`${v}T00:00:00`);
    return isNaN(d.getTime()) ? v : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  return v;
}

export default function ProductInfoCard({ product }: { product: Product }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => toForm(product));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof ProductInfo, v: string) =>
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === "approved" && v !== "Yes") next.approval_date = ""; // date only applies when approved
      return next;
    });

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(product.slug)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const input = "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Product information</h2>
          <p className="text-xs text-slate-500">
            Entered manually{product.info_updated_at ? ` · last edited ${new Date(product.info_updated_at).toLocaleString()}` : " · not filled in yet"}
          </p>
        </div>
        {!editing ? (
          <button
            onClick={() => {
              setForm(toForm(product));
              setEditing(true);
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </div>

      {error && <div className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

      <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        {FIELDS.map(({ key, label, wide }) => (
          <div key={key} className={`border-t border-slate-100 py-2.5 ${wide ? "sm:col-span-2" : ""}`}>
            <dt className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
            <dd className="text-sm text-slate-800">
              {!editing ? (
                display(product, key) ?? <span className="text-slate-300">—</span>
              ) : key === "approved" ? (
                <select value={form.approved} onChange={(e) => set("approved", e.target.value)} className={input}>
                  <option value="">—</option>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              ) : key === "approval_date" ? (
                <input
                  type="date"
                  value={form.approval_date}
                  onChange={(e) => set("approval_date", e.target.value)}
                  disabled={form.approved !== "Yes"}
                  title={form.approved !== "Yes" ? "Set Approved = Yes first" : undefined}
                  className={`${input} disabled:bg-slate-50 disabled:text-slate-400`}
                />
              ) : (
                <>
                  <input
                    value={form[key]}
                    onChange={(e) => set(key, e.target.value)}
                    list={SUGGEST[key] ? `suggest-${key}` : undefined}
                    className={input}
                  />
                  {SUGGEST[key] && (
                    <datalist id={`suggest-${key}`}>
                      {SUGGEST[key]!.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  )}
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
