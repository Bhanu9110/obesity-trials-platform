"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Product, ProductInfo } from "@/lib/types";

// Drug profile and product details, entered by hand with the Edit button. Everything
// starts blank except "No. of trials", which is counted from the database.

// Typing aids only (a dropdown while typing) — every field accepts free text.
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
    "Incretin-based therapy", "Amylin-based therapy", "Centrally acting anti-obesity agent",
    "Peripherally acting anti-obesity agent", "Melanocortin pathway", "Antidiabetic", "Lipid-lowering",
  ],
  therapy_subclass: [
    "GLP-1 receptor agonist", "GIP/GLP-1 dual agonist", "GLP-1/glucagon dual agonist",
    "GIP/GLP-1/glucagon triple agonist", "Amylin analogue", "Amylin/GLP-1 dual agonist",
    "Oral small-molecule GLP-1 RA", "MC4R agonist", "Lipase inhibitor", "Sympathomimetic amine",
    "Activin type II receptor antibody", "CB1 receptor antagonist", "SGLT2 inhibitor", "Biguanide",
  ],
};

type Field = { key: keyof ProductInfo; label: string; wide?: boolean };

// Drug profile, in the order of the Drugs-list columns. "No. of trials" sits after Candidate.
const PROFILE: Field[] = [
  { key: "aliases", label: "Alias" },
  { key: "brand_names", label: "Brand name" },
  { key: "candidate", label: "Candidate" },
  { key: "parent_drug", label: "Similar / parent drug" },
  { key: "sponsor", label: "Company name" },
  { key: "drug_class", label: "Therapy class" },
  { key: "therapy_subclass", label: "Therapy subclass" },
  { key: "indication", label: "Indication", wide: true },
];
const DETAILS: Field[] = [
  { key: "modality", label: "Modality" },
  { key: "phase", label: "Phase" },
  { key: "moa", label: "MOA (mechanism of action)", wide: true },
  { key: "roa", label: "ROA (route of administration)" },
  { key: "approved", label: "Approved" },
  { key: "approval_date", label: "Approval date" },
];
const ALL = [...PROFILE, ...DETAILS];

function toForm(p: Product): Record<keyof ProductInfo, string> {
  return Object.fromEntries(ALL.map(({ key }) => [key, p[key] ?? ""])) as Record<keyof ProductInfo, string>;
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

export default function ProductInfoCard({ product, readOnly = false }: { product: Product; readOnly?: boolean }) {
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

  const input = "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500";

  const editor = (key: keyof ProductInfo) => {
    if (key === "candidate") {
      return (
        <select value={form.candidate} onChange={(e) => set("candidate", e.target.value)} className={input}>
          <option value="">—</option>
          <option value="Pipeline">Pipeline</option>
          <option value="Non-pipeline">Non-pipeline</option>
        </select>
      );
    }
    if (key === "approved") {
      return (
        <select value={form.approved} onChange={(e) => set("approved", e.target.value)} className={input}>
          <option value="">—</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
        </select>
      );
    }
    if (key === "approval_date") {
      return (
        <input
          type="date"
          value={form.approval_date}
          onChange={(e) => set("approval_date", e.target.value)}
          disabled={form.approved !== "Yes"}
          title={form.approved !== "Yes" ? "Set Approved = Yes first" : undefined}
          className={`${input} disabled:bg-slate-50 disabled:text-slate-400`}
        />
      );
    }
    return (
      <>
        <input value={form[key]} onChange={(e) => set(key, e.target.value)} list={SUGGEST[key] ? `suggest-${key}` : undefined} className={input} />
        {SUGGEST[key] && (
          <datalist id={`suggest-${key}`}>
            {SUGGEST[key]!.map((s) => <option key={s} value={s} />)}
          </datalist>
        )}
      </>
    );
  };

  const cell = ({ key, label, wide }: Field) => (
    <div key={key} className={`border-t border-slate-100 py-2.5 ${wide ? "sm:col-span-2" : ""}`}>
      <dt className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-800">
        {editing ? editor(key) : display(product, key) ?? <span className="text-slate-300">—</span>}
      </dd>
    </div>
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Drug profile</h2>
          <p className="text-xs text-slate-500">
            {readOnly ? "Curated" : "Entered manually"}{product.info_updated_at ? ` · last edited ${new Date(product.info_updated_at).toLocaleString()}` : " · not filled in yet"}
          </p>
        </div>
        {readOnly ? null : !editing ? (
          <button
            onClick={() => { setForm(toForm(product)); setEditing(true); }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} disabled={saving}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button onClick={save} disabled={saving}
                    className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </div>

      {error && <div className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

      <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        {PROFILE.slice(0, 3).map(cell)}
        <div className="border-t border-slate-100 py-2.5">
          <dt className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">No. of trials</dt>
          <dd className="text-sm text-slate-800" title="Counted automatically from the trials in the database">
            <span className="font-semibold tabular-nums">{product.trials.toLocaleString()}</span>
            {product.all_trials > product.trials && (
              <span className="ml-1.5 text-xs text-slate-400">+{(product.all_trials - product.trials).toLocaleString()} other stored</span>
            )}
          </dd>
        </div>
        {PROFILE.slice(3).map(cell)}
      </dl>

      <h3 className="mb-1 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">Product details</h3>
      <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        {DETAILS.map(cell)}
      </dl>
    </section>
  );
}
