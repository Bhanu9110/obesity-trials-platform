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
| **Trial ID** (NCT…) | CT.gov — clicking it opens the full trial page on this website |
| **Intervention** | drug / biological / combination-product interventions, grouped into **drugs** |
| **Phase** | CT.gov phases |
| **Sponsor** | lead sponsor (+ sponsor class for the Industry / Government / Academic filter) |
| **Indication** | CT.gov conditions |
| **Location** | site countries → **continents** |
| **Status, start, participants** | CT.gov overall status, start date, enrollment (shown on drug pages) |

Everything else (descriptions, eligibility, outcomes, arms, sites, results…) is
**not** stored. Clicking a Trial ID opens the **trial page** (`/trials/NCT…`), which
reads the complete record from the ClinicalTrials.gov API when it is opened (cached
on the server for 6 hours) and shows every section the registry shows — study
overview, participation criteria, study plan and arms, outcome measures, sites and
contacts, sponsors and investigators, publications, record dates, IPD sharing,
documents, MeSH terms and, when posted, the full **results** (participant flow,
baseline, outcome measures with statistical analyses, adverse events). It also shows
what this database holds about the trial (drugs, classification and why, data
quality, change history). If the registry cannot be reached, the page falls back to
the stored fields. Optional settings: `CTGOV_API_BASE`, `CTGOV_CACHE_SECONDS`.

Scope: CT.gov search `obesity OR overweight OR obese OR "weight management" OR "weight loss"
OR "weight reduction" OR adiposity`, start date ≥ 2000, trials with a **drug, biological or
combination-product** intervention. Only trials that pass **both** rules below are stored; everything else is skipped at
download time (and removed if it was stored before, with a "removed" entry on the
Changes page):

1. **Primary obesity** — obesity / obese / overweight / morbid obesity / hyperlipidemia /
   dyslipidemia / a genetic-obesity syndrome is the **lead condition**: the first condition
   listed on the registry (items such as "Healthy volunteers", pharmacokinetics,
   "Metabolism and Nutrition Disorder" or "Bariatric surgery" are skipped). When another
   disease is listed first (Alzheimer's, heart failure, PCOS, pregnancy, type 2 diabetes…)
   obesity is a **comorbidity** and the trial is not stored — unless the title names obesity
   as the treated condition ("Treatment of Obesity With Type 2 Diabetes"). Also not stored:
   weight-related trials without an obesity term ("weight gain", lipodystrophy,
   contraception) and trials that are not about obesity at all.
   **Industry-sponsored trials** (competitor programmes) are also kept when they test a
   weight-loss drug (-glutide, -tirzepatide, -glipron, -lintide… or an investigational code
   name) in people the title describes as having obesity — e.g. tirzepatide in OSA with
   obesity, SURMOUNT-2 (type 2 diabetes with obesity) — and when they are weight-management
   or healthy-volunteer / drug-interaction studies whose title names obesity. Older trials
   of unrelated drugs in obese patients ("anticoagulants in obese patients with atrial
   fibrillation") are comorbidity and not stored.
   Negated diseases ("non-diabetic") are ignored, and several conditions typed into one
   field ("Type 2 Diabetes; Obesity") are split.
2. **A drug is named** — a specific drug, or a drug class, which becomes an
   "Undisclosed …" drug (e.g. "GLP-1 receptor agonist" → *Undisclosed GLP-1 receptor
   agonist*). Trials naming only placebo, study arms, diet, devices or a sentence are not stored.

Rules live in `sync/src/obesity-filter.ts` and `sync/src/products.ts`; bumping
`CLASSIFIER_VERSION`, `PRODUCT_RULES_VERSION` or `STORE_SCOPE` (sync.ts) makes the next run
re-apply them to every stored trial (no download). Changing the search terms triggers one
automatic full sync.

## Drug pages

Every intervention is normalised into a **drug** (product): doses, formulations,
routes and salts are stripped, placebos dropped, brand and code names folded into
the INN (e.g. *Wegovy*, *Semaglutide 2.4 mg pen* → **Semaglutide**;
*LY3502970* → **Orforglipron**; *Phentermine-Topiramate* / *Qsymia* →
**Phentermine + Topiramate**).

Click a drug anywhere to open its page:

- **Drug profile** — Alias, Brand name, Candidate (Pipeline / Non-pipeline),
  No. of trials (counted automatically), Similar / parent drug, Company name,
  Therapy class / subclass and Indication, plus product details (Modality, Phase,
  MOA, ROA, Approved, Approval date). Everything except the trial count starts
  **blank** and is filled in by hand with the *Edit* button. The daily sync never
  overwrites it.
- **Trials** — a clickable **phase bar** (trial count per phase), a summary line
  (recruiting / active, industry, participants, start years), one toolbar (search,
  Industry / Non-industry switch, status, continent, sort) and the trials grouped by
  phase. Each trial shows its title and recruitment status, then NCT ID, sponsor (with
  an Industry tag), start date, participants and continents; conditions other than
  plain obesity are listed under "Also". Clicking a trial opens its trial page.
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
npm run daily               # what the daily job does (upgrade if needed, catch-up, retry queue)
npm run retry               # retry failed records that are due
npm run failures            # show the retry queue and the dead-letter queue
npm run requeue NCT…        # put dead-letter records back in the retry queue (or: npm run dismiss NCT…)
npm run classify            # re-classify stored trials (primary / comorbidity / weight-related / not obesity)
npm run health              # pipeline health checks (exit code 1 on failure)
npm run rebuild-products    # re-derive drugs (after editing product_aliases by hand)
npm run enrich-products     # auto-fill blank drug-profile fields (trials + ChEMBL + openFDA); --no-external = trials only
npm run reparse             # re-map raw_trials with the current parser (no download); --all for every record
npm run quality             # recompute the data-quality checks (results: website → Data quality)
npm run migrate:status      # which migrations are applied / pending / edited
npm test                    # tests (needs DATABASE_URL)
```

With Docker: `docker compose run --rm scheduler npm run rebuild-products` (same for `reparse`, `quality`).

## Layout

```
db/migrations/   0001 extensions · 0002 lean schema · 0003 sync log ·
                 0004 country→continent · 0005 convert an older DB · 0006 indexes ·
                 0007 ingestion lineage + data quality · 0008 lock tables against Supabase's public API ·
                 0009 obesity classification, change history, retry / dead-letter queue
db/run-migrations.sh  tracked runner (schema_migrations, one transaction per migration)
sync/src/        ctgov-client (fields-limited API fetch) · mapper (parser, hashing) · validate ·
                 products (drug normalisation) · obesity-filter (classification) · quality ·
                 history (change log) · failures (retry / dead-letter) · health · sync · scheduler
web/app/         / (trials) · /drugs · /drugs/[slug] · /changes · /quality · /admin · api/* (incl. /api/health)
```

## Customising

- **Continents** — country → continent mapping lives in
  `db/migrations/0004_country_continent.sql`; unknown countries show as *Other*.
- **Drug merges** — use the Merge button, or insert into `product_aliases`
  (`alias_slug` = the lower-case alphanumeric name, `product_slug` = target drug's
  slug) and run `rebuild-products`.
- **Automatic drug profiles** — `sync/src/enrich.ts`, run daily after the sync. Blank
  drug-profile fields are filled from the trial data, [ChEMBL](https://www.ebi.ac.uk/chembl/)
  (modality, mechanism, codes, trade names) and [openFDA](https://open.fda.gov/apis/drug/drugsfda/)
  (US brands, route, first US approval). Values go to `products.auto_info` and show on the
  drug page with an "auto" tag; a value typed in on the website always wins and is never
  overwritten. openFDA is checked for every drug that is due in each run (by ingredient
  name, then by brand name); ChEMBL for up to `ENRICH_MAX_LOOKUPS` (200) drugs per run.
  Each drug is re-checked every `ENRICH_REFRESH_DAYS` (30). Add the repository secret
  `OPENFDA_API_KEY` (free key from https://open.fda.gov/apis/authentication/) so all drugs
  fit in one run; without it openFDA allows about 900 drugs a day. openFDA only knows
  FDA-approved / US-marketed drugs, so investigational drugs get no openFDA values.
- **Drug code names (Alias field)** — collected automatically from the drug's company
  pipeline page (`sync/data/pipeline-sources.json`, re-checked monthly; add confirmed
  pairs under `known`), ChEMBL, ClinicalTrials.gov "other names", trial titles such as
  "Enicepatide (CT-388)" and the built-in alias list. Each value shows its source.
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

| `trial_changes` | change history: new trial, field-by-field registry updates (old → new), reclassification, removal — website **Changes** tab. |
| `sync_failures` | retry queue + dead-letter queue (see *Reliability*). |

Unchanged records (same content hash and parser) are skipped — only `last_seen_at` moves.
Records are written in batches (`SYNC_BATCH_SIZE`, default 250) with a few set-based
statements per batch, so a full download stays quick even when the database is far away
(GitHub's US runners → a Supabase project in Mumbai: ~2 minutes instead of hours).
If a first full download is ever cut off, the next run finishes it automatically.
When the parser changes (`PARSER_VERSION` in `sync/src/mapper.ts`), stored raw records are
re-parsed automatically on the next start — no re-download. A database upgraded from the
previous version gets one automatic full sync to fill in its lineage.

## Reliability

- **Validation** — every record is checked before it is written: NCT ID format, known
  phase values, real and plausible dates, control characters, over-long text. Bad
  records are not written; cleaned values are written and listed on the Data quality
  page ("Values cleaned on import").
- **Retry queue** — a record that fails is retried on later runs (re-fetched by NCT ID),
  12 h, 1 d, 2 d, 4 d… apart. Success removes it from the queue.
- **Dead-letter queue** — after `SYNC_MAX_ATTEMPTS` (5) failures in a row it waits for a
  person: Admin page → *Re-queue* or *Dismiss* (or `npm run requeue` / `dismiss`).
- **Removal guard** — a full download never removes more than max(50, 20 %) of stored
  trials at once (protects against a truncated CT.gov response); override once with
  `SYNC_ALLOW_LARGE_PRUNE=true`.
- **Abandoned runs** — a run killed by a time limit is closed as *failed* on the next start.
- **Health checks** — `npm run health` (run by the daily job; a failure emails you),
  the Admin page *Health* panel, and `GET /api/health` (no login, for uptime monitors;
  HTTP 503 when broken). Checks: database, migrations, last successful sync (warn 36 h,
  fail 72 h), latest run, trials present, dead-letter queue, removal guard.

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

**Phase 2 — Make CT.gov production-grade — done**
- [x] Better retry queue
- [x] Dead-letter queue
- [x] Change history
- [x] Better validation
- [x] Better obesity classification
- [x] More tests (21 tests: classification, validation, queues, history, guards, health)
- [x] Proper health checks

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
- [x] change history UI (basic: Changes tab)
- [ ] pipeline monitoring
- [ ] export API
