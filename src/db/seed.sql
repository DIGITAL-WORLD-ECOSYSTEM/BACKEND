-- ============================================================================
-- ASOT GENESIS SEED SCRIPT (100% Schema 10/10 Certified)
-- ============================================================================
-- Limpeza inicial
DELETE FROM password_credentials;
DELETE FROM user_authenticators;
DELETE FROM financial_ledger_entries;
DELETE FROM financial_fees;
DELETE FROM account_balances;
DELETE FROM financial_accounts;
DELETE FROM financial_transactions;
DELETE FROM financial_assets;
DELETE FROM membership_cards;
DELETE FROM identity_documents;
DELETE FROM citizens;
DELETE FROM user_profiles;
DELETE FROM users;

-- 1. USERS BASE
INSERT INTO users (id, subject_type, email, email_normalized, status, auth_epoch, created_at, updated_at)
VALUES 
  (1, 'system', 'admin@asppibra.com', 'admin@asppibra.com', 'active', 1, unixepoch(), unixepoch()),
  (2, 'human', 'felipe.dev@asppibra.com', 'felipe.dev@asppibra.com', 'active', 1, unixepoch(), unixepoch());

-- 2. USER PROFILES
INSERT INTO user_profiles (user_id, username, username_normalized, display_name, profile_visibility, is_discoverable, created_at, updated_at)
VALUES 
  (1, 'admin', 'admin', 'Administrador ASOT', 'private', 0, unixepoch(), unixepoch()),
  (2, 'felipedev', 'felipedev', 'Felipe Dev', 'public', 1, unixepoch(), unixepoch());

-- 3. USER AUTHENTICATORS & PASSWORD CREDENTIALS (Senha Padrão: Admin@123456)
INSERT INTO user_authenticators (id, user_id, type, label, verified_at, created_at, updated_at)
VALUES 
  ('auth_admin_01', 1, 'password', 'Primary Password', unixepoch(), unixepoch(), unixepoch()),
  ('auth_felipe_02', 2, 'password', 'Primary Password', unixepoch(), unixepoch(), unixepoch());

INSERT INTO password_credentials (authenticator_id, password_hash)
VALUES 
  ('auth_admin_01', 'IPxA0RtNWjsP8pH8V9Qkbw==:5d26aa9c6351ad152951701c6250a747fd2e214cc9e443cb3b345dfe8f12f7d7'),
  ('auth_felipe_02', 'IPxA0RtNWjsP8pH8V9Qkbw==:5d26aa9c6351ad152951701c6250a747fd2e214cc9e443cb3b345dfe8f12f7d7');

-- 4. CITIZENS (CIVIL IDENTITY BASE)
INSERT INTO citizens (user_id, legal_first_name, legal_last_name, nationality_code, civil_status, verified_at, verified_by, created_at, updated_at)
VALUES 
  (2, 'Felipe', 'Dev', 'BR', 'verified', unixepoch(), 1, unixepoch(), unixepoch());

-- 5. IDENTITY DOCUMENTS (CPF / RG)
INSERT INTO identity_documents (id, user_id, document_type, country_code, number_lookup_hash, encrypted_number, last4, source, verification_status, verified_at, verified_by, created_at, updated_at)
VALUES 
  (1, 2, 'cpf', 'BR', 'hash_cpf_11111111111', 'enc_cpf_11111111111', '1111', 'government', 'verified', unixepoch(), 1, unixepoch(), unixepoch());

-- 6. FINANCIAL ASSETS
INSERT INTO financial_assets (id, code, symbol, name, type, decimals, status, created_at, updated_at)
VALUES 
  (1, 'BRL', 'R$', 'Real Brasileiro', 'fiat', 2, 'active', unixepoch(), unixepoch()),
  (2, 'USD', 'US$', 'Dólar Americano', 'fiat', 2, 'active', unixepoch(), unixepoch()),
  (3, 'BTC', '₿', 'Bitcoin', 'crypto', 8, 'active', unixepoch(), unixepoch()),
  (4, 'ETH', 'Ξ', 'Ethereum', 'crypto', 18, 'active', unixepoch(), unixepoch());

-- 7. FINANCIAL ACCOUNTS
INSERT INTO financial_accounts (id, user_id, account_type, status, name, created_at, updated_at)
VALUES 
  (1, NULL, 'treasury', 'active', 'DAO Treasury Account', unixepoch(), unixepoch()),
  (2, NULL, 'operating', 'active', 'DAO Operating Account', unixepoch(), unixepoch()),
  (3, NULL, 'fees', 'active', 'DAO Platform Fees Account', unixepoch(), unixepoch()),
  (4, 2, 'user_available', 'active', 'Felipe Dev Primary Account', unixepoch(), unixepoch());

-- 8. ACCOUNT BALANCES (Unidades Base em String/BigInt Text)
INSERT INTO account_balances (id, account_id, asset_id, available_base_units, locked_base_units, version, updated_at)
VALUES 
  (1, 1, 1, '100000000', '0', 1, unixepoch()), -- R$ 1.000.000,00 na Tesouraria
  (2, 4, 1, '100000', '0', 1, unixepoch());    -- R$ 1.000,00 na Conta do Felipe

-- 9. FINANCIAL TRANSACTIONS
INSERT INTO financial_transactions (id, user_id, type, category, status, description, completed_at, version, created_at, updated_at)
VALUES 
  (1, 2, 'deposit', 'other', 'completed', 'Aporte Inicial Genesis (R$ 1.000,00)', unixepoch(), 1, unixepoch(), unixepoch());

-- 10. DOUBLE-ENTRY LEDGER ENTRIES
INSERT INTO financial_ledger_entries (id, transaction_id, account_id, asset_id, direction, amount_base_units, created_at)
VALUES 
  (1, 1, 4, 1, 'credit', '100000', unixepoch());
