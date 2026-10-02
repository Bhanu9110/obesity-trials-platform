# Obesity Drug Trials Database (ClinicalTrials.gov)

A lean drug database of obesity clinical trials, auto-updated daily from the
**ClinicalTrials.gov v2 API**, stored in **PostgreSQL**, and served by a
**Next.js** app.

> **Host it online for free (with login):** see [DEPLOY.md](DEPLOY.md) — Supabase database +
> Vercel website + daily GitHub Actions update (all free plans).

## What is stored

Only what the drug database needs — per trial:

| Field | Source |
|---|---|
| **Trial ID** (NCT…) | CT.gov — clicking it opens the study on clinicaltrials.gov |
| **Intervention** | drug / biological / combination-product interventions, grouped into **drugs** |
| **Phase** | CT.gov phases |
| **Sponsor** | lead sponsor (+ sponsor class for the Industry / Government / Academic filter) |
| **Indication** | CT.gov conditions |
| **Location** | site countries → **continents** |

Everything else (titles, eligibility, outcomes, arms, sites, raw payloads, NLP
embeddings, audit history) is **not** stored — the NCT ID links to the full record
on ClinicalTrials.gov.

Scope (unchanged): condition `obesity`, start date ≥ 2000, drug studies, and only
trials whose **primary indication** is obesity / obese / overweight / morbid
obesity / hyperlipidemia / dyslipidemia (comorbidity or subject-type trials are excluded).

## Drug pages

Every intervention is normalised into a **drug** (product): doses, formulations,
routes and salts are stripped, placebos dropped, brand and code names folded into
the INN (e.g. *Wegovy*, *Semaglutide 2.4 mg pen* → **Semaglutide**;
*LY3502970* → **Orforglipron**; *Phentermine-Topiramate* / *Qsymia* →
**Phentermine + Topiramate**).

Click a drug anywhere to open its page:

- **Product information** — Modality, Phase, MOA, ROA, Approved (Yes/No),
  Approval date, Sponsor, Class. These start **blank** and are filled in manually
  with the *Edit* button. The daily sync never overwrites them.
- **Trials** — every trial of the drug with its Trial ID (→ clinicaltrials.gov),
  phase, sponsor, indication and continents.
- **Merge** — if a drug is a duplicate (registry typo, code name, brand name),
  *“Duplicate of another drug? Merge it…”* moves its trials into the right drug.
  Merges are remembered (table `product_aliases`) so future syncs keep them.

The **Drugs** tab lists all drugs with trial counts and lets you filter to those
whose info is still blank.

## Run it (Docker)

```bash
docker compose up --build --remove-orphans
# Web:       http://localhost:3000
# Postgres:  localhost:55432  (user/pass postgres/postgres, db obesity_trials)
```

1. `migrate` applies any pending migrations (tracked in `schema_migrations`; each runs once).
2. `scheduler` backfills all trials on an empty database, then syncs every day at
   midnight (`SYNC_TZ`, default Asia/Kolkata) and on every start (catch-up).
3. `web` serves the app.

### Upgrading an existing database

The Compose project name is fixed (`obesity-trials-platform-ctgov`), so the database
volume is reused whichever folder you unzip into. Stop the old stack first
(`docker compose down` in the old folder — **without** `-v`), then start this one.

On start, the migration converts the old wide schema to the lean one: it keeps
phase, sponsor, indication, drug interventions and countries/continents, deletes the
soft-deleted (non-primary-obesity) rows, and drops the bulky tables. The scheduler
then builds the drug pages automatically. `--remove-orphans` removes the old NLP
containers.

## Commands (sync/)

```bash
npm run sync                # incremental sync now
npm run backfill            # full re-download of every trial
npm run rebuild-products    # re-derive drugs (after editing product_aliases by hand)
npm run reparse             # re-map raw_trials with the current parser (no download); --all for every record
npm run quality             # recompute the data-quality checks (results: website → Data quality)
npm run migrate:status      # which migrations are applied / pending / edited
npm run prune-nonobesity    # dry-run: list non-primary-obesity trials; add --apply to delete
npm test                    # tests (needs DATABASE_URL)
```

With Docker: `docker compose run --rm scheduler npm run rebuild-products` (same for `reparse`, `quality`).

## Layout

```
db/migrations/   0001 extensions · 0002 lean schema · 0003 sync log ·
                 0004 country→continent · 0005 convert an older DB · 0006 indexes ·
                 0007 ingestion lineage + data quality · 0008 lock tables against Supabase's public API
db/run-migrations.sh  tracked runner (schema_migrations, one transaction per migration)
sync/src/        ctgov-client (fields-limited API fetch) · mapper (parser, hashing) ·
                 products (drug normalisation) · obesity-filter · quality · sync · scheduler
web/app/         / (trials) · /drugs · /drugs/[slug] · /admin · api/*
```

## Customising

- **Continents** — country → continent mapping lives in
  `db/migrations/0004_country_continent.sql`; unknown countries show as *Other*.
- **Drug merges** — use the Merge button, or insert into `product_aliases`
  (`alias_slug` = the lower-case alphanumeric name, `product_slug` = target drug's
  slug) and run `rebuild-products`.
- **Drug-matching rules** — `sync/src/products.ts`. Bump `PRODUCT_RULES_VERSION`
  after changing them; the scheduler rebuilds automatically on next start.

## Data lineage & quality

Every ingested record is traceable:

| Table / column | What it holds |
|---|---|
| `schema_migrations` | each applied migration: version, sha256 checksum, time. Migrations run once, in a transaction, under a lock; edited migrations are flagged. |
| `raw_trials` | the CT.gov record as ingested (only the fetched fields), its **content hash** (sha256 of canonical JSON), the **parser version** that mapped it, `source_updated_at`, first/last seen, last changed, and the sync run that changed it. |
| `trial_sources` | which registry record(s) each trial comes from (`source`, `source_id`, URL). One row per CT.gov record today; CTIS / ChiCTR will map onto the same trial. |
| `trials` | + `source_updated_at`, `first_seen_at`, `last_seen_at`, `last_changed_at`, `parser_version`, `record_hash`, `last_run_id`. `version` only increases when the stored record really changes. |
| `trial_quality` / `data_quality_summary` | per-trial score (1.0 = clean) and issues: missing sponsor/phase/conditions/location, no drug matched, unmatched interventions, unknown country, missing update date. |
| `sync_runs` | + mode (full / incremental / reparse), parser version, unchanged and filtered counts. |

Unchanged records (same content hash and parser) are skipped — only `last_seen_at` moves.
When the parser changes (`PARSER_VERSION` in `sync/src/mapper.ts`), stored raw records are
re-parsed automatically on the next start — no re-download. A database upgraded from the
previous version gets one automatic full sync to fill in its lineage.

## Roadmap

**Priority 1 — done**
- [x] Proper migration tracking
- [x] raw_trials
- [x] trial_sources
- [x] source_updated_at
- [x] ingestion timestamps
- [x] parser version
- [x] content hash
- [x] data-quality table

**Phase 2 — Make CT.gov production-grade**
- [ ] Better retry queue
- [ ] Dead-letter queue
- [ ] Change history
- [ ] Better validation
- [ ] Better obesity classification
- [ ] More tests
- [ ] Proper health checks

**Phase 3 — Product intelligence**
- [ ] intervention table
- [ ] canonical products
- [ ] aliases
- [ ] sponsor normalization
- [ ] drug class
- [ ] mechanism
- [ ] indication classification

**Phase 4 — Multi-registry**
- [ ] CTIS
- [ ] ChiCTR
- [ ] source adapters
- [ ] canonical trial IDs
- [ ] cross-registry deduplication

**Phase 5 — Platform**
- [ ] authenticated admin
- [ ] advanced search
- [x] data-quality dashboard
- [ ] change history UI
- [ ] pipeline monitoring
- [ ] export API
