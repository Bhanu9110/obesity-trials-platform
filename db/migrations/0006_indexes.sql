-- 0006_indexes.sql
-- Indexes for the Browse filters, keyword search and drug pages.
BEGIN;

CREATE INDEX IF NOT EXISTS idx_trials_phase         ON trials (phase);
CREATE INDEX IF NOT EXISTS idx_trials_sponsor_class ON trials (lead_sponsor_class);
CREATE INDEX IF NOT EXISTS idx_trials_conditions    ON trials USING GIN (conditions);
CREATE INDEX IF NOT EXISTS idx_trials_countries     ON trials USING GIN (countries);
CREATE INDEX IF NOT EXISTS idx_trials_continents    ON trials USING GIN (continents);
CREATE INDEX IF NOT EXISTS idx_trial_products_prod  ON trial_products (product_id);

COMMIT;
