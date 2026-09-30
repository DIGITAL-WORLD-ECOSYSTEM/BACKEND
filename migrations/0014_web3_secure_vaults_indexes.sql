-- 0014_web3_secure_vaults_indexes.sql
-- Web3 Module: Secure Vaults Cardinality Hardening & Key Reference Uniqueness
-- Permite que usuários possuam múltiplas carteiras Web3 (purpose = 'private_key') sem violar o cofre ativo único.

-- 1. Remover índices legados restritivos
DROP INDEX IF EXISTS `uq_secure_vaults_active_purpose`;--> statement-breakpoint
DROP INDEX IF EXISTS `uq_secure_vaults_user_purpose_version`;--> statement-breakpoint

-- 2. Recriar índices parciais ignorando 'private_key' para permitir carteiras múltiplas e lotes
CREATE UNIQUE INDEX IF NOT EXISTS `uq_secure_vaults_active_purpose` ON `secure_vaults` (`user_id`, `purpose`) WHERE `revoked_at` IS NULL AND `purpose` != 'private_key';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_secure_vaults_user_purpose_version` ON `secure_vaults` (`user_id`, `purpose`, `key_version`) WHERE `purpose` != 'private_key';--> statement-breakpoint

-- 3. Índice único para rastreabilidade de chave privada por key_reference
CREATE UNIQUE INDEX IF NOT EXISTS `uq_secure_vaults_key_reference` ON `secure_vaults` (`key_reference`);
