-- 0005_data_remediation.sql
-- Data Remediation & Pre-Constraint Standardization Script

ALTER TABLE `did_identities` ADD COLUMN `is_primary` integer NOT NULL DEFAULT 0;

-- 1. Canonicalize usernames in citizens table
UPDATE citizens
SET username = LOWER(TRIM(username))
WHERE username IS NOT NULL AND username != LOWER(TRIM(username));


-- 3. Resolve multiple primary DIDs by keeping only the latest active created DID as primary
UPDATE did_identities
SET is_primary = 0
WHERE is_primary = 1 AND id NOT IN (
    SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
        FROM did_identities
        WHERE is_primary = 1 AND status = 'active'
    ) sub WHERE sub.rn = 1
);

-- 4. Initialize OCC version columns where NULL
UPDATE did_identities SET version = 1 WHERE version IS NULL OR version < 1;
UPDATE verifiable_credentials SET version = 1 WHERE version IS NULL OR version < 1;
UPDATE citizens SET version = 1 WHERE version IS NULL OR version < 1;
UPDATE account_balances SET version = 1 WHERE version IS NULL OR version < 1;
UPDATE financial_accounts SET version = 1 WHERE version IS NULL OR version < 1;
