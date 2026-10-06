"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Product } from "@/lib/types";

// "Product summary": a hand-written description of the drug, entered and updated
// on this page (members and owners; guests can only read it).

export default function ProductSummaryCard({ product, readOnly = false }: { product: Product; readOnly?: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(product.summary ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing to show a guest until a summary has been written.
  if (readOnly && !product.summary) return null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/products/${encodeURIComponent(product.slug)}/summary`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ summary: text }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const btn = "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:border-brand-500/50 hover:text-slate-950";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-slate-950">Product summary</h2>
        {!readOnly && !editing && (
          <button type="button" onClick={() => { setText(product.summary ?? ""); setEditing(true); }} className={btn}>
            {product.summary ? "Edit" : "Write summary"}
          </button>
        )}
      </div>

      {editing ? (
        <div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} maxLength={4000} autoFocus
                    placeholder={`Write the product summary for ${product.name}…`}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm leading-relaxed outline-none" />
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm text-white disabled:opacity-60">
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className={btn}>Cancel</button>
            <span className="ml-auto text-xs text-slate-400">{text.length.toLocaleString()} / 4,000</span>
          </div>
          {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        </div>
      ) : product.summary ? (
        <div>
          <p className="whitespace-pre-line text-[15px] leading-relaxed text-slate-800">{product.summary}</p>
          {product.summary_updated_at && (
            <p className="mt-2 text-[11px] text-slate-400">
              Updated {new Date(product.summary_updated_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-slate-400">No summary yet.</p>
      )}
    </section>
  );
}
