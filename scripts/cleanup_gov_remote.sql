-- 1. Remover carteiras vinculadas aos usuários de teste
DELETE FROM wallets WHERE user_id IN (1, 21, 25);

-- 2. Remover cidadãos dos usuários de teste
DELETE FROM citizens WHERE user_id IN (1, 21, 25);

-- 3. Remover sessões dos usuários de teste
DELETE FROM user_sessions WHERE user_id IN (1, 21, 25);

-- 4. Remover os usuários do sistema
DELETE FROM users WHERE id IN (1, 21, 25);
