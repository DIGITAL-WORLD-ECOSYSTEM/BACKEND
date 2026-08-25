-- ============================================================================
-- ASPPIBRA DAO - MANUAL ACCOUNT BALANCE RECONCILIATION SCRIPT
-- Reconciliação do Saldo Devedor da Conta 10 (Andressa de Lima Ferreira)
-- Ajuste: R$ 800,00 (80000 centavos) via Crédito na Conta 10 e Débito na Conta 1
-- ============================================================================

-- 1. Inserção da Transação de Reconciliação Auditada
INSERT INTO financial_transactions (
  user_id,
  type,
  category, 
  status, 
  description, 
  counterparty_name, 
  origin_institution, 
  destination_institution, 
  payment_method, 
  source_proof, 
  completed_at,
  created_at,
  updated_at
) VALUES (
  10, 
  'adjustment',
  'operational', 
  'completed', 
  'Ajuste de Reconciliação Auditada - Correção de Saldo Devedor', 
  'Sistema de Tesouraria ASPPIBRA', 
  'Conta de Ajuste Institucional', 
  'Conta de Associado 10', 
  'ajuste_manual', 
  'Audit_Proof_Ref_2026_08_20', 
  unixepoch(),
  unixepoch(),
  unixepoch()
);

-- 2. Lado 1: Lançamento de Crédito na Conta da Associada (Conta 10)
INSERT INTO financial_ledger_entries (
  transaction_id, 
  account_id, 
  asset_id,
  direction, 
  amount_base_units, 
  created_at
) VALUES (
  (SELECT id FROM financial_transactions ORDER BY id DESC LIMIT 1), 
  10, 
  1,
  'credit', 
  '80000', 
  unixepoch()
);

-- 3. Lado 2: Lançamento Espelho de Débito na Conta Institucional de Ajuste (Conta 1)
INSERT INTO financial_ledger_entries (
  transaction_id, 
  account_id, 
  asset_id,
  direction, 
  amount_base_units, 
  created_at
) VALUES (
  (SELECT id FROM financial_transactions ORDER BY id DESC LIMIT 1), 
  1, 
  1,
  'debit', 
  '80000', 
  unixepoch()
);

-- 4. Atualiza o saldo devedor real na tabela account_balances (R$ 28.377,00 em centavos = 2837700)
UPDATE account_balances 
SET locked_base_units = '2837700', updated_at = unixepoch() 
WHERE account_id = 10;
