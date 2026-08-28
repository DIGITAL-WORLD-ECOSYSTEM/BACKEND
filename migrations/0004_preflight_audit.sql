-- 0004_preflight_audit.sql
-- Forensic Preflight Diagnostic Script for ASPPIBRA Identity, SSI & Finance Hardening

-- 1. Identify OAuth identities violating uniqueness
SELECT provider_id, provider_subject, COUNT(*) as count
FROM oauth_identities
GROUP BY provider_id, provider_subject
HAVING COUNT(*) > 1;

-- 2. Identify active WebAuthn credentials without authenticators or revoked
SELECT c.id, c.authenticator_id, a.revoked_at
FROM webauthn_credentials c
LEFT JOIN user_authenticators a ON c.authenticator_id = a.id
WHERE a.id IS NULL OR a.revoked_at IS NOT NULL;

-- 3. Identify users with multiple active primary DIDs
SELECT user_id, COUNT(*) as primary_count
FROM did_identities
WHERE is_primary = 1 AND status = 'active'
GROUP BY user_id
HAVING COUNT(*) > 1;

-- 4. Identify Citizens with uncanonicalized usernames
SELECT id, username, LOWER(TRIM(username)) as canonical_username
FROM citizens
WHERE username IS NOT NULL AND username != LOWER(TRIM(username));

-- 5. Identify Unbalanced Financial Transactions (Double-Entry violation)
SELECT transaction_id,
       SUM(CASE WHEN direction = 'debit' THEN amount_base_units ELSE 0 END) as total_debit,
       SUM(CASE WHEN direction = 'credit' THEN amount_base_units ELSE 0 END) as total_credit
FROM financial_ledger_entries
GROUP BY transaction_id
HAVING total_debit != total_credit;
