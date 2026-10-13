-- 0022_company_reports.sql
-- Company pipeline reports (e.g. Novo Nordisk's Q2 2026 investor presentation) are loaded the
-- same way as conference abstracts (sync/data/conference/*.json, "kind": "company_report").
-- A phase the company reports for its own drug ("Phase 1b/2", "Terminated (Phase 2)") is
-- shown on the drug page ahead of the phase worked out from trials and databases.

ALTER TABLE conference_abstracts ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'abstract';
