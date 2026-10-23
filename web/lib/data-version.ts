import { query } from "@/lib/db";

/**
 * A short fingerprint of everything the website counts. It changes whenever the data
 * changes: a sync run starts or finishes, a trial is added / changed / removed, a drug
 * is edited, merged or re-classified, quality is re-checked, or conference abstracts
 * are loaded. Open pages ask for it every minute (components/LiveRefresh.tsx) and
 * reload their numbers when it changes, so nobody has to press refresh.
 *
 * Cheap on purpose: a handful of max() / count() over small tables, one round trip.
 */
export async function dataVersion(): Promise<string> {
  const r = await query<{ v: string }>(
    `SELECT md5(concat_ws('|',
       (SELECT count(*) || ':' || coalesce(max(run_at)::text, '') FROM sync_runs),
       (SELECT status FROM sync_runs ORDER BY run_at DESC NULLS LAST LIMIT 1),
       (SELECT count(*) || ':' || coalesce(max(last_changed_at)::text, '') FROM trials WHERE is_active),
       (SELECT count(*) FROM trials WHERE is_active AND obesity_class = 'primary'),
       (SELECT coalesce(max(id)::text, '') FROM trial_changes),
       (SELECT count(*) || ':' || count(*) FILTER (WHERE kind IS NULL) || ':'
               || coalesce(greatest(max(info_updated_at), max(summary_updated_at), max(auto_updated_at))::text, '')
          FROM products),
       (SELECT count(*) FROM trial_products),
       (SELECT count(*) FROM product_aliases),
       (SELECT count(*) || ':' || coalesce(max(checked_at)::text, '') FROM trial_quality),
       (SELECT count(*) FROM product_abstracts),
       (SELECT count(*) FILTER (WHERE status = 'pending') || ':' || count(*) FILTER (WHERE status = 'dead') FROM sync_failures)
     )) AS v`,
  );
  return r[0]?.v ?? "";
}
