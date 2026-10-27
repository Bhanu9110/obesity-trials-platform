-- 0025_other_drug_kind.sql
-- A third way to leave an entry out of the obesity drug list: kind = 'other_drug' — a real
-- medicine that has no effect on obesity and appears in obesity trials only alongside the
-- obesity drug (anaesthetics, painkillers and antibiotics around surgery, blood-pressure and
-- cholesterol medicines, contraceptives and probe drugs in drug-interaction studies …).
-- Like 'supplement' and 'not_drug' it stays in the database with its trials.

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_kind_check;
ALTER TABLE products ADD CONSTRAINT products_kind_check CHECK (kind IN ('supplement', 'not_drug', 'other_drug'));
