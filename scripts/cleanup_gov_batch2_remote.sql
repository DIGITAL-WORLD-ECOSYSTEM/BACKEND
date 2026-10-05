-- Remover cidadãos
DELETE FROM citizens WHERE user_id IN (22, 23, 24, 26);

-- Remover sessões
DELETE FROM user_sessions WHERE user_id IN (22, 23, 24, 26);

-- Remover os usuários
DELETE FROM users WHERE id IN (22, 23, 24, 26);
