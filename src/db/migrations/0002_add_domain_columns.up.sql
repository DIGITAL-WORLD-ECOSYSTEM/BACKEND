ALTER TABLE financial_transactions ADD COLUMN counterparty_name TEXT;
ALTER TABLE financial_transactions ADD COLUMN origin_institution TEXT;
ALTER TABLE financial_transactions ADD COLUMN destination_institution TEXT;
ALTER TABLE financial_transactions ADD COLUMN payment_method TEXT;
ALTER TABLE financial_transactions ADD COLUMN source_proof TEXT;
