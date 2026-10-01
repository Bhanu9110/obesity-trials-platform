// Central configuration, read from the environment with sane defaults.
export const config = {
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://postgres@localhost:5432/obesity_trials",

  ctgov: {
    baseUrl: process.env.CTGOV_BASE_URL ?? "https://clinicaltrials.gov/api/v2",
    // The condition keyword that scopes this platform. Only "obesity" trials.
    condition: process.env.CTGOV_CONDITION ?? "obesity",
    pageSize: Number(process.env.CTGOV_PAGE_SIZE ?? 100),
    // Statuses to include. Empty string => ALL statuses (used for the full
    // backfill so historical/terminated trials since 2000 are included).
    statuses: (process.env.CTGOV_STATUSES ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    // Lower bound on trial StartDate for the corpus. "all data from year 2000".
    startDateFrom: process.env.CTGOV_START_DATE_FROM ?? "2000-01-01",
    // Restrict to trials that contain at least one of these intervention types.
    // Empty => all study types. Set "DRUG" for drug/capsule studies only
    // (excludes exercise/behavioral/device/procedure-only trials). You can list
    // several, e.g. "DRUG,DIETARY_SUPPLEMENT,BIOLOGICAL".
    interventionTypes: (process.env.CTGOV_INTERVENTION_TYPES ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
    // Keep only trials whose PRIMARY indication is obesity (obesity/obese/overweight/
    // hyperlipidemia/dyslipidemia/morbid obesity), excluding comorbidity/subject-type
    // trials. Applied on every sync so the auto-updating DB stays clean. Set
    // CTGOV_OBESITY_INDICATION_ONLY=false to store all obesity drug trials instead.
    obesityIndicationOnly:
      (process.env.CTGOV_OBESITY_INDICATION_ONLY ?? "true").toLowerCase() === "true",
    // Ask CT.gov for only the fields we store (much smaller, faster downloads).
    // Set CTGOV_FIELDS="" to download full records instead. If the API rejects the
    // list, the client automatically falls back to full records.
    fields: (process.env.CTGOV_FIELDS ??
      "NCTId,Phase,LeadSponsorName,LeadSponsorClass,Condition,InterventionType,InterventionName,LocationCountry")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    // How many days back an incremental sync looks.
    incrementalDays: Number(process.env.CTGOV_INCREMENTAL_DAYS ?? 1),
    // Politeness: pause between page fetches (ms).
    requestDelayMs: Number(process.env.CTGOV_REQUEST_DELAY_MS ?? 250),
    maxRetries: Number(process.env.CTGOV_MAX_RETRIES ?? 4),
  },

  // Scheduler (daily auto-update).
  scheduler: {
    // Cron expression; default 00:00 every day (midnight).
    cron: process.env.SYNC_CRON ?? "0 0 * * *",
    // Timezone the cron runs in. Default the host TZ; set e.g. Asia/Kolkata.
    tz: process.env.SYNC_TZ ?? process.env.TZ ?? "",
    // On startup, run a full backfill when the trials table is empty.
    backfillOnStartIfEmpty:
      (process.env.SYNC_BACKFILL_ON_START ?? "true").toLowerCase() === "true",
  },
} as const;
