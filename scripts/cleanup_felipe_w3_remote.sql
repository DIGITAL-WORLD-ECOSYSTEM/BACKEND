-- 1. Lançamentos contábeis de Felipe
DELETE FROM financial_ledger_entries 
WHERE account_id IN (SELECT id FROM financial_accounts WHERE user_id = 2) 
   OR transaction_id IN (SELECT id FROM financial_transactions WHERE user_id = 2);

-- 2. Transações financeiras de Felipe
DELETE FROM financial_transactions WHERE user_id = 2;

-- 3. Saldos da conta de Felipe
DELETE FROM account_balances 
WHERE account_id IN (SELECT id FROM financial_accounts WHERE user_id = 2);

-- 4. Contas financeiras de Felipe
DELETE FROM financial_accounts WHERE user_id = 2;

-- 5. Documentos de identidade e Cidadão
DELETE FROM identity_documents WHERE user_id = 2;
DELETE FROM citizens WHERE user_id = 2;

-- 6. Perfil de usuário
DELETE FROM user_profiles WHERE user_id = 2;

-- 7. Credenciais e Autenticadores
DELETE FROM password_credentials 
WHERE authenticator_id IN (SELECT id FROM user_authenticators WHERE user_id = 2);
DELETE FROM user_authenticators WHERE user_id = 2;

-- 8. Sessões e Tokens
DELETE FROM user_sessions WHERE user_id = 2;
DELETE FROM refresh_token_families WHERE user_id = 2;

-- 9. Eventos de segurança
DELETE FROM security_events WHERE user_id = 2;

-- 10. Usuário Felipe
DELETE FROM users WHERE id = 2;
