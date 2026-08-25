-- ============================================================================
-- ASPPIBRA DAO - REPORT AUDIT SEED SCRIPT (Andressa de Lima Ferreira)
-- Total Pago Real Comprovado: R$ 36.623,00 | Saldo Devedor: R$ 29.177,00 | Total: R$ 65.800,00
-- Fonte: Auditoria_ASPPIBRA_Andressa.xlsx (45 Transações Auditadas - Datas Estabilizadas 12:00 UTC)
-- ============================================================================

-- 0. Garantir Ativo BRL (id=1)
INSERT OR IGNORE INTO financial_assets (id, code, symbol, name, type, decimals, status, created_at, updated_at)
VALUES (1, 'BRL', 'R$', 'Real Brasileiro', 'fiat', 2, 'active', unixepoch(), unixepoch());

-- 1. Inserção do Usuário Principal (Andressa de Lima Ferreira)
INSERT OR IGNORE INTO users (id, subject_type, email, email_normalized, status, auth_epoch, created_at, updated_at)
VALUES (10, 'human', 'andressa.ferreira@email.com', 'andressa.ferreira@email.com', 'active', 1, 1691452800, 1691452800);

INSERT OR IGNORE INTO user_profiles (user_id, username, username_normalized, display_name, profile_visibility, is_discoverable, created_at, updated_at)
VALUES (10, 'andressa2024001', 'andressa2024001', 'Andressa de Lima Ferreira', 'public', 1, 1691452800, 1691452800);

INSERT OR IGNORE INTO user_authenticators (id, user_id, type, label, verified_at, created_at, updated_at)
VALUES ('auth_andressa_10', 10, 'password', 'Primary Password', unixepoch(), unixepoch(), unixepoch());

INSERT OR IGNORE INTO password_credentials (authenticator_id, password_hash)
VALUES ('auth_andressa_10', 'IPxA0RtNWjsP8pH8V9Qkbw==:5d26aa9c6351ad152951701c6250a747fd2e214cc9e443cb3b345dfe8f12f7d7');

INSERT OR IGNORE INTO citizens (user_id, legal_first_name, legal_last_name, nationality_code, civil_status, verified_at, verified_by, created_at, updated_at)
VALUES (10, 'Andressa', 'de Lima Ferreira', 'BR', 'verified', 1691452800, 1, 1691452800, 1691452800);

INSERT OR IGNORE INTO identity_documents (id, user_id, document_type, country_code, number_lookup_hash, encrypted_number, last4, source, verification_status, verified_at, verified_by, created_at, updated_at)
VALUES (10, 10, 'cpf', 'BR', 'hash_cpf_17379356780', 'enc_cpf_17379356780', '780', 'government', 'verified', 1691452800, 1, 1691452800, 1691452800);

-- 2. Inserção dos Provedores Fiat / Bancos Participantes
INSERT OR IGNORE INTO fiat_providers (id, name, code, type, status, created_at, updated_at)
VALUES
  (1, 'Itaú Unibanco', 'ITAU', 'bank', 'active', unixepoch(), unixepoch()),
  (2, 'Nu Pagamentos', 'NUBANK', 'payment_provider', 'active', unixepoch(), unixepoch()),
  (3, 'Bradesco', 'BRADESCO', 'bank', 'active', unixepoch(), unixepoch()),
  (4, 'Mercado Pago', 'MERCADO_PAGO', 'payment_provider', 'active', unixepoch(), unixepoch()),
  (5, 'Banco Inter', 'INTER', 'bank', 'active', unixepoch(), unixepoch()),
  (6, 'Santander', 'SANTANDER', 'bank', 'active', unixepoch(), unixepoch()),
  (7, 'Cora SCFI', 'CORA', 'bank', 'active', unixepoch(), unixepoch());

-- 3. Contas Financeiras da Andressa e da Tesouraria
INSERT OR IGNORE INTO financial_accounts (id, user_id, account_type, status, name, created_at, updated_at)
VALUES
  (10, 10, 'user_available', 'active', 'Conta Andressa de Lima Ferreira (#2024001)', unixepoch(), unixepoch()),
  (11, NULL, 'treasury', 'active', 'Tesouraria Consolidada ASPPIBRA (Ref: 2026-07-PM4)', unixepoch(), unixepoch());

-- 4. Saldo Consolidado da Conta (Total Pago Comprovado: R$ 36.623,00 | Saldo Devedor: R$ 29.177,00)
INSERT OR REPLACE INTO account_balances (id, account_id, asset_id, available_base_units, locked_base_units, version, updated_at)
VALUES
  (10, 10, 1, '3662300', '2917700', 1, unixepoch()),
  (11, 11, 1, '3662300', '0', 1, unixepoch());

-- 5. Limpeza de registros anteriores
DELETE FROM financial_ledger_entries WHERE id >= 100 OR transaction_id >= 101;
DELETE FROM financial_transactions WHERE id >= 101;

-- 6. Inserção das 45 Transações Auditadas da Planilha (Datas Estabilizadas em UTC)
INSERT INTO financial_transactions (id, user_id, type, category, status, description, completed_at, version, created_at, updated_at)
VALUES
  (101, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Itaú Unibanco -> Nu Pagamentos', 1691496000, 1, 1691496000, 1691496000),
  (102, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Itaú Unibanco -> Nu Pagamentos', 1691582400, 1, 1691582400, 1691582400),
  (103, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Itaú Unibanco -> Nu Pagamentos', 1695297600, 1, 1695297600, 1695297600),
  (104, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Itaú Unibanco -> Nu Pagamentos', 1697803200, 1, 1697803200, 1697803200),
  (105, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Itaú Unibanco -> Nu Pagamentos', 1700568000, 1, 1700568000, 1700568000),
  (106, 10, 'payment', 'operational', 'completed', 'Pagamento Sandro Alves de Amorim via Itaú Unibanco -> Bradesco', 1703160000, 1, 1703160000, 1703160000),
  (107, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Itaú Unibanco -> Itaú Unibanco', 1703246400, 1, 1703246400, 1703246400),
  (108, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Itaú Unibanco -> Itaú Unibanco', 1708084800, 1, 1708084800, 1708084800),
  (109, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Itaú Unibanco -> Itaú Unibanco', 1710158400, 1, 1710158400, 1710158400),
  (110, 10, 'payment', 'operational', 'completed', 'Pagamento Sandro Alves de Amorim via Mercado Pago -> Bradesco', 1714478400, 1, 1714478400, 1714478400),
  (111, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Mercado Pago -> Itaú Unibanco', 1714478400, 1, 1714478400, 1714478400),
  (112, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Mercado Pago -> Itaú Unibanco', 1716984000, 1, 1716984000, 1716984000),
  (113, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Mercado Pago -> Itaú Unibanco', 1719230400, 1, 1719230400, 1719230400),
  (114, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Mercado Pago -> Itaú Unibanco', 1722168000, 1, 1722168000, 1722168000),
  (115, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Itaú Unibanco -> Itaú Unibanco', 1725624000, 1, 1725624000, 1725624000),
  (116, 10, 'payment', 'operational', 'completed', 'Pagamento Sandro Alves de Amorim via Itaú Unibanco -> Bradesco', 1725624000, 1, 1725624000, 1725624000),
  (117, 10, 'payment', 'operational', 'completed', 'Pagamento Sandro Alves de Amorim via Itaú Unibanco -> Bradesco', 1728475200, 1, 1728475200, 1728475200),
  (118, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Mercado Pago -> Itaú Unibanco', 1731153600, 1, 1731153600, 1731153600),
  (119, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Mercado Pago -> Itaú Unibanco', 1734523200, 1, 1734523200, 1734523200),
  (120, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Mercado Pago -> Itaú Unibanco', 1737460800, 1, 1737460800, 1737460800),
  (121, 10, 'payment', 'operational', 'completed', 'Pagamento Sandro Alves de Amorim via Mercado Pago -> Bradesco', 1737460800, 1, 1737460800, 1737460800),
  (122, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Itaú Unibanco -> Itaú Unibanco', 1739188800, 1, 1739188800, 1739188800),
  (123, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Mercado Pago -> Itaú Unibanco', 1742385600, 1, 1742385600, 1742385600),
  (124, 10, 'payment', 'operational', 'completed', 'Pagamento Sandro Alves de Amorim via Mercado Pago -> Bradesco', 1745323200, 1, 1745323200, 1745323200),
  (125, 10, 'payment', 'operational', 'completed', 'Pagamento Sandro Alves de Amorim via Mercado Pago -> Bradesco', 1746014400, 1, 1746014400, 1746014400),
  (126, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Mercado Pago -> Itaú Unibanco', 1747483200, 1, 1747483200, 1747483200),
  (127, 10, 'payment', 'operational', 'completed', 'Pagamento Sandro Alves de Amorim via Itaú Unibanco -> Banco Inter', 1750161600, 1, 1750161600, 1750161600),
  (128, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Mercado Pago -> Itaú Unibanco', 1750161600, 1, 1750161600, 1750161600),
  (129, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Nu Pagamentos -> Itaú Unibanco', 1753531200, 1, 1753531200, 1753531200),
  (130, 10, 'payment', 'operational', 'completed', 'Pagamento Sandro Alves de Amorim via Nu Pagamentos -> Banco Inter', 1753531200, 1, 1753531200, 1753531200),
  (131, 10, 'payment', 'operational', 'completed', 'Pagamento Sandro Alves de Amorim via Itaú Unibanco -> Banco Inter', 1755259200, 1, 1755259200, 1755259200),
  (132, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Itaú Unibanco -> Santander', 1760356800, 1, 1760356800, 1760356800),
  (133, 10, 'payment', 'operational', 'completed', 'Pagamento ASPPIBRA via Mercado Pago (boleto Cora) -> Cora SCFI', 1763380800, 1, 1763380800, 1763380800),
  (134, 10, 'payment', 'operational', 'completed', 'Pagamento ASPPIBRA via Nu Pagamentos -> Cora SCFI', 1764936000, 1, 1764936000, 1764936000),
  (135, 10, 'payment', 'operational', 'completed', 'Pagamento ASPPIBRA via Nu Pagamentos -> Cora SCFI', 1770638400, 1, 1770638400, 1770638400),
  (136, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Nu Pagamentos -> Santander', 1770638400, 1, 1770638400, 1770638400),
  (137, 10, 'payment', 'operational', 'completed', 'Pagamento ASPPIBRA via Nu Pagamentos -> Cora SCFI', 1772971200, 1, 1772971200, 1772971200),
  (138, 10, 'payment', 'operational', 'completed', 'Pagamento ASPPIBRA via Itaú Unibanco -> Cora SCFI', 1773144000, 1, 1773144000, 1773144000),
  (139, 10, 'payment', 'operational', 'completed', 'Pagamento ASPPIBRA via Banco Inter -> Cora SCFI', 1773576000, 1, 1773576000, 1773576000),
  (140, 10, 'payment', 'membership', 'completed', 'Pagamento Paulo Roberto Batista Ferreira via Banco Inter -> Santander', 1774612800, 1, 1774612800, 1774612800),
  (141, 10, 'payment', 'other', 'failed', 'Linha Falha - Sem transação real', NULL, 1, 1705320000, 1705320000),
  (142, 10, 'payment', 'other', 'failed', 'Linha Falha - Sem transação real', NULL, 1, 1723723200, 1723723200),
  (143, 10, 'payment', 'other', 'failed', 'Linha Falha - Sem transação real', NULL, 1, 1757937600, 1757937600),
  (144, 10, 'payment', 'other', 'failed', 'Linha Falha - Sem transação real', NULL, 1, 1768478400, 1768478400),
  (145, 10, 'payment', 'other', 'failed', 'Linha Falha - Sem transação real', NULL, 1, 1776254400, 1776254400);

-- 7. Lançamentos de Partidas Dobradas (40 Transações Comprovadas)
INSERT INTO financial_ledger_entries (id, transaction_id, account_id, asset_id, direction, amount_base_units, created_at)
VALUES
  (101, 101, 11, 1, 'credit', '500000', 1691496000),
  (102, 102, 11, 1, 'credit', '500000', 1691582400),
  (103, 103, 11, 1, 'credit', '80000', 1695297600),
  (104, 104, 11, 1, 'credit', '80000', 1697803200),
  (105, 105, 11, 1, 'credit', '80000', 1700568000),
  (106, 106, 11, 1, 'credit', '70000', 1703160000),
  (107, 107, 11, 1, 'credit', '80000', 1703246400),
  (108, 108, 11, 1, 'credit', '80000', 1708084800),
  (109, 109, 11, 1, 'credit', '80000', 1710158400),
  (110, 110, 11, 1, 'credit', '70000', 1714478400),
  (111, 111, 11, 1, 'credit', '80000', 1714478400),
  (112, 112, 11, 1, 'credit', '80000', 1716984000),
  (113, 113, 11, 1, 'credit', '80000', 1719230400),
  (114, 114, 11, 1, 'credit', '80000', 1722168000),
  (115, 115, 11, 1, 'credit', '80000', 1725624000),
  (116, 116, 11, 1, 'credit', '70000', 1725624000),
  (117, 117, 11, 1, 'credit', '80000', 1728475200),
  (118, 118, 11, 1, 'credit', '80000', 1731153600),
  (119, 119, 11, 1, 'credit', '80000', 1734523200),
  (120, 120, 11, 1, 'credit', '80000', 1737460800),
  (121, 121, 11, 1, 'credit', '70000', 1737460800),
  (122, 122, 11, 1, 'credit', '80000', 1739188800),
  (123, 123, 11, 1, 'credit', '80000', 1742385600),
  (124, 124, 11, 1, 'credit', '40000', 1745323200),
  (125, 125, 11, 1, 'credit', '40000', 1746014400),
  (126, 126, 11, 1, 'credit', '75000', 1747483200),
  (127, 127, 11, 1, 'credit', '35000', 1750161600),
  (128, 128, 11, 1, 'credit', '80000', 1750161600),
  (129, 129, 11, 1, 'credit', '66700', 1753531200),
  (130, 130, 11, 1, 'credit', '66700', 1753531200),
  (131, 131, 11, 1, 'credit', '66700', 1755259200),
  (132, 132, 11, 1, 'credit', '100000', 1760356800),
  (133, 133, 11, 1, 'credit', '105000', 1763380800),
  (134, 134, 11, 1, 'credit', '55000', 1764936000),
  (135, 135, 11, 1, 'credit', '80000', 1770638400),
  (136, 136, 11, 1, 'credit', '70000', 1770638400),
  (137, 137, 11, 1, 'credit', '25000', 1772971200),
  (138, 138, 11, 1, 'credit', '25000', 1773144000),
  (139, 139, 11, 1, 'credit', '25000', 1773576000),
  (140, 140, 11, 1, 'credit', '67200', 1774612800);
