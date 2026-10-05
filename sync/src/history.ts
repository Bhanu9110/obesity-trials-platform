// Change history (table trial_changes).
//
// Field changes are computed from what the REGISTRY says (the parsed CT.gov
// record before vs after), so re-deriving drugs or re-running the parser does
// not create noise. Classification changes are recorded as "reclassified".

import type { MappedTrial } from "./mapper.js";
import type { Client } from "./db.js";
import { pool } from "./db.js";

export type ChangeKind = "added" | "updated" | "removed" | "reclassified";

export interface ChangeRow {
  trial_id: string;
  change: ChangeKind;
  field: string | null;
  old_value: unknown;
  new_value: unknown;
}

/** Registry fields whose changes are tracked. */
export const TRACKED_FIELDS = ["phase", "sponsor", "lead_sponsor_class", "conditions", "interventions", "countries", "overall_status"] as const;
/** Fields added later: the first time they are filled in is not a change. */
const FILL_ONLY = new Set<string>(["overall_status"]);

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Field-by-field differences between two parsed versions of one trial. */
export function diffMapped(prev: MappedTrial, next: MappedTrial): ChangeRow[] {
  const rows: ChangeRow[] = [];
  for (const f of TRACKED_FIELDS) {
    if (FILL_ONLY.has(f) && prev[f] == null) continue;
    if (!same(prev[f], next[f])) {
      rows.push({ trial_id: next.nct_id, change: "updated", field: f, old_value: prev[f] ?? null, new_value: next[f] ?? null });
    }
  }
  return rows;
}

/** Short snapshot stored with "added" / "removed" rows. */
export function snapshot(t: { phase: string | null; sponsor: string | null; obesity_class?: string | null }) {
  return { phase: t.phase ?? null, sponsor: t.sponsor ?? null, obesity_class: t.obesity_class ?? null };
}

/** Insert change rows (one statement). */
export async function insertChanges(db: Client | typeof pool, rows: ChangeRow[], runId: string | null): Promise<void> {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = rows.slice(i, i + 2000);
    await db.query(
      `INSERT INTO trial_changes (trial_id, run_id, change, field, old_value, new_value)
       SELECT x.trial_id, $2, x.change, x.field, x.old_value, x.new_value
         FROM jsonb_to_recordset($1::jsonb)
           AS x(trial_id text, change text, field text, old_value jsonb, new_value jsonb)`,
      [JSON.stringify(chunk), runId],
    );
  }
}
