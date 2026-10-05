-- 1. Atribuir papel de Admin para sandro_ceo@asppibra.com.br (user_id: 6)
INSERT OR IGNORE INTO user_roles (user_id, role_id, grant_source, version) 
VALUES (6, 1, 'system_bootstrap', 1);

-- 2. Transferir verificação de identidade e cidadania para sandro_ceo (user_id: 6)
UPDATE identity_documents SET verified_by = 6 WHERE verified_by = 1;
UPDATE citizens SET verified_by = 6 WHERE verified_by = 1;

-- 3. Remover credenciais de senha dos usuários de teste (1, 3, 4, 5)
DELETE FROM password_credentials 
WHERE authenticator_id IN (
    SELECT id FROM user_authenticators WHERE user_id IN (1, 3, 4, 5)
);

-- 4. Remover autenticadores
DELETE FROM user_authenticators WHERE user_id IN (1, 3, 4, 5);

-- 5. Remover papéis vinculados
DELETE FROM user_roles WHERE user_id IN (1, 3, 4, 5);

-- 6. Remover perfis de usuário
DELETE FROM user_profiles WHERE user_id IN (1, 3, 4, 5);

-- 7. Remover sessões de usuário
DELETE FROM user_sessions WHERE user_id IN (1, 3, 4, 5);

-- 8. Remover famílias de refresh tokens
DELETE FROM refresh_token_families WHERE user_id IN (1, 3, 4, 5);

-- 9. Remover eventos de segurança
DELETE FROM security_events WHERE user_id IN (1, 3, 4, 5);

-- 10. Remover os usuários
DELETE FROM users WHERE id IN (1, 3, 4, 5);
