"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Product, ProductInfo } from "@/lib/types";

// Drug profile. Blank fields are filled automatically every day (trial data, ChEMBL,
// openFDA) and marked "auto"; a value typed in with the Edit button always wins and is
// never overwritten. "No. of trials" is counted from the database.

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

const autoOf = (p: Product, key: keyof ProductInfo) => p.auto?.[key] ?? null;

/** The form holds only hand-entered values: an automatic value stays automatic unless typed over. */
function toForm(p: Product): Record<keyof ProductInfo, string> {
  return Object.fromEntries(ALL.map(({ key }) => [key, autoOf(p, key) ? "" : p[key] ?? ""])) as Record<keyof ProductInfo, string>;
}

function formatValue(key: keyof ProductInfo, v: string): string {
  if (key === "approval_date") {
    if (/^\d{4}$/.test(v)) return v; // only the year is known
    const d = new Date(`${v}T00:00:00`);
    return isNaN(d.getTime()) ? v : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  return v;
}

function display(p: Product, key: keyof ProductInfo): string | null {
  const v = p[key];
  return v ? formatValue(key, v) : null;
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
      if (k === "approved" && v === "No") next.approval_date = ""; // no approval date for a drug that is not approved
      return next;
    });
  const autoCount = ALL.filter(({ key }) => autoOf(product, key)).length;
  const approvedNow = form.approved || autoOf(product, "approved")?.value || "";

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

  // In the editor, a blank field shows the automatic value it will keep ("auto: …").
  const autoHint = (key: keyof ProductInfo) => {
    const a = autoOf(product, key);
    return a ? `auto: ${formatValue(key, a.value)}` : null;
  };

  const editor = (key: keyof ProductInfo) => {
    if (key === "candidate") {
      return (
        <select value={form.candidate} onChange={(e) => set("candidate", e.target.value)} className={input}>
          <option value="">{autoHint("candidate") ?? "—"}</option>
          <option value="Pipeline">Pipeline (industry drug)</option>
          <option value="Non-pipeline">Non-pipeline (academic drug)</option>
        </select>
      );
    }
    if (key === "approved") {
      return (
        <select value={form.approved} onChange={(e) => set("approved", e.target.value)} className={input}>
          <option value="">{autoHint("approved") ?? "—"}</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
        </select>
      );
    }
    if (key === "approval_date") {
      return (
        <>
          <input
            type="date"
            value={form.approval_date}
            onChange={(e) => set("approval_date", e.target.value)}
            disabled={approvedNow !== "Yes"}
            title={approvedNow !== "Yes" ? "Set Approved = Yes first" : undefined}
            className={`${input} disabled:bg-slate-50 disabled:text-slate-400`}
          />
          {!form.approval_date && autoHint("approval_date") && (
            <p className="mt-1 text-[11px] text-slate-400">{autoHint("approval_date")}</p>
          )}
        </>
      );
    }
    return (
      <>
        <input value={form[key]} onChange={(e) => set(key, e.target.value)} list={SUGGEST[key] ? `suggest-${key}` : undefined}
               placeholder={autoHint(key) ?? undefined} className={`${input} placeholder:text-slate-400`} />
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
        {editing ? editor(key) : (() => {
          const v = display(product, key);
          if (!v) return <span className="text-slate-300">—</span>;
          const a = autoOf(product, key);
          return (
            <>
              {v}
              {a && (
                <span title={`Filled automatically from ${a.source}. Click Edit to type your own value.`}
                      className="ml-1.5 inline-flex cursor-help items-center rounded bg-brand-500/10 px-1.5 py-px align-[1px] text-[10px] font-semibold uppercase tracking-wide text-brand-700 ring-1 ring-brand-500/20">
                  auto
                </span>
              )}
            </>
          );
        })()}
      </dd>
    </div>
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Drug profile</h2>
          <p className="text-xs text-slate-500">
            {autoCount > 0
              ? `${autoCount} field${autoCount === 1 ? "" : "s"} filled automatically from trial data, ChEMBL and openFDA`
              : readOnly ? "Curated" : "Entered manually"}
            {product.info_updated_at ? ` · last edited by hand ${new Date(product.info_updated_at).toLocaleString()}` : ""}
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
        {DETAILS.map(cell)}
      </dl>
    </section>
  );
}
