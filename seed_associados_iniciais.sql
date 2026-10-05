-- ============================================================================
-- SEED: CADASTRO PRELIMINAR DE ASSOCIADOS (SOMENTE NOMES)
-- Status: pending_setup (dados complementares a confirmar no futuro)
-- ============================================================================

-- 1. Garantir que a role citizen existe
INSERT OR IGNORE INTO roles (id, key, display_name, description, status, is_system, version, created_at, updated_at)
VALUES (2, 'citizen', 'Cidadão / Associado', 'Membro associado da ASPPIBRA', 'active', 1, 1, unixepoch(), unixepoch());

-- Associado ID 7: Andressa de Lima Ferreira
INSERT INTO users (id, subject_type, email, email_normalized, status, auth_epoch, created_at, updated_at) VALUES (7, 'human', NULL, NULL, 'pending_setup', 1, unixepoch(), unixepoch());
INSERT INTO user_profiles (user_id, username, username_normalized, display_name, profile_visibility, is_discoverable, created_at, updated_at) VALUES (7, 'andressa_ferreira', 'andressa_ferreira', 'Andressa de Lima Ferreira', 'private', 0, unixepoch(), unixepoch());
INSERT INTO citizens (user_id, username, legal_first_name, legal_last_name, nationality_code, civil_status, created_at, updated_at) VALUES (7, 'citizen_andressa_ferreira', 'Andressa', 'de Lima Ferreira', 'BR', 'pending', unixepoch(), unixepoch());
INSERT INTO user_roles (user_id, role_id, grant_source, granted_by, version, created_at, updated_at) VALUES (7, 2, 'admin', 6, 1, unixepoch(), unixepoch());

-- Associado ID 8: Adilson Chaves de Moura
INSERT INTO users (id, subject_type, email, email_normalized, status, auth_epoch, created_at, updated_at) VALUES (8, 'human', NULL, NULL, 'pending_setup', 1, unixepoch(), unixepoch());
INSERT INTO user_profiles (user_id, username, username_normalized, display_name, profile_visibility, is_discoverable, created_at, updated_at) VALUES (8, 'adilson_moura', 'adilson_moura', 'Adilson Chaves de Moura', 'private', 0, unixepoch(), unixepoch());
INSERT INTO citizens (user_id, username, legal_first_name, legal_last_name, nationality_code, civil_status, created_at, updated_at) VALUES (8, 'citizen_adilson_moura', 'Adilson', 'Chaves de Moura', 'BR', 'pending', unixepoch(), unixepoch());
INSERT INTO user_roles (user_id, role_id, grant_source, granted_by, version, created_at, updated_at) VALUES (8, 2, 'admin', 6, 1, unixepoch(), unixepoch());

-- Associado ID 9: Marlon Pinto de Lima
INSERT INTO users (id, subject_type, email, email_normalized, status, auth_epoch, created_at, updated_at) VALUES (9, 'human', NULL, NULL, 'pending_setup', 1, unixepoch(), unixepoch());
INSERT INTO user_profiles (user_id, username, username_normalized, display_name, profile_visibility, is_discoverable, created_at, updated_at) VALUES (9, 'marlon_lima', 'marlon_lima', 'Marlon Pinto de Lima', 'private', 0, unixepoch(), unixepoch());
INSERT INTO citizens (user_id, username, legal_first_name, legal_last_name, nationality_code, civil_status, created_at, updated_at) VALUES (9, 'citizen_marlon_lima', 'Marlon', 'Pinto de Lima', 'BR', 'pending', unixepoch(), unixepoch());
INSERT INTO user_roles (user_id, role_id, grant_source, granted_by, version, created_at, updated_at) VALUES (9, 2, 'admin', 6, 1, unixepoch(), unixepoch());

-- Associado ID 10: João Batista Pires
INSERT INTO users (id, subject_type, email, email_normalized, status, auth_epoch, created_at, updated_at) VALUES (10, 'human', NULL, NULL, 'pending_setup', 1, unixepoch(), unixepoch());
INSERT INTO user_profiles (user_id, username, username_normalized, display_name, profile_visibility, is_discoverable, created_at, updated_at) VALUES (10, 'joao_pires', 'joao_pires', 'João Batista Pires', 'private', 0, unixepoch(), unixepoch());
INSERT INTO citizens (user_id, username, legal_first_name, legal_last_name, nationality_code, civil_status, created_at, updated_at) VALUES (10, 'citizen_joao_pires', 'João Batista', 'Pires', 'BR', 'pending', unixepoch(), unixepoch());
INSERT INTO user_roles (user_id, role_id, grant_source, granted_by, version, created_at, updated_at) VALUES (10, 2, 'admin', 6, 1, unixepoch(), unixepoch());

-- Associado ID 11: Valdeci dos Santos Alves
INSERT INTO users (id, subject_type, email, email_normalized, status, auth_epoch, created_at, updated_at) VALUES (11, 'human', NULL, NULL, 'pending_setup', 1, unixepoch(), unixepoch());
INSERT INTO user_profiles (user_id, username, username_normalized, display_name, profile_visibility, is_discoverable, created_at, updated_at) VALUES (11, 'valdeci_alves', 'valdeci_alves', 'Valdeci dos Santos Alves', 'private', 0, unixepoch(), unixepoch());
INSERT INTO citizens (user_id, username, legal_first_name, legal_last_name, nationality_code, civil_status, created_at, updated_at) VALUES (11, 'citizen_valdeci_alves', 'Valdeci', 'dos Santos Alves', 'BR', 'pending', unixepoch(), unixepoch());
INSERT INTO user_roles (user_id, role_id, grant_source, granted_by, version, created_at, updated_at) VALUES (11, 2, 'admin', 6, 1, unixepoch(), unixepoch());

-- Associado ID 12: Vanessa Rocha Antunes
INSERT INTO users (id, subject_type, email, email_normalized, status, auth_epoch, created_at, updated_at) VALUES (12, 'human', NULL, NULL, 'pending_setup', 1, unixepoch(), unixepoch());
INSERT INTO user_profiles (user_id, username, username_normalized, display_name, profile_visibility, is_discoverable, created_at, updated_at) VALUES (12, 'vanessa_antunes', 'vanessa_antunes', 'Vanessa Rocha Antunes', 'private', 0, unixepoch(), unixepoch());
INSERT INTO citizens (user_id, username, legal_first_name, legal_last_name, nationality_code, civil_status, created_at, updated_at) VALUES (12, 'citizen_vanessa_antunes', 'Vanessa', 'Rocha Antunes', 'BR', 'pending', unixepoch(), unixepoch());
INSERT INTO user_roles (user_id, role_id, grant_source, granted_by, version, created_at, updated_at) VALUES (12, 2, 'admin', 6, 1, unixepoch(), unixepoch());

-- Associado ID 13: Luís Carlos dos Anjos
INSERT INTO users (id, subject_type, email, email_normalized, status, auth_epoch, created_at, updated_at) VALUES (13, 'human', NULL, NULL, 'pending_setup', 1, unixepoch(), unixepoch());
INSERT INTO user_profiles (user_id, username, username_normalized, display_name, profile_visibility, is_discoverable, created_at, updated_at) VALUES (13, 'luis_anjos', 'luis_anjos', 'Luís Carlos dos Anjos', 'private', 0, unixepoch(), unixepoch());
INSERT INTO citizens (user_id, username, legal_first_name, legal_last_name, nationality_code, civil_status, created_at, updated_at) VALUES (13, 'citizen_luis_anjos', 'Luís Carlos', 'dos Anjos', 'BR', 'pending', unixepoch(), unixepoch());
INSERT INTO user_roles (user_id, role_id, grant_source, granted_by, version, created_at, updated_at) VALUES (13, 2, 'admin', 6, 1, unixepoch(), unixepoch());

-- Associado ID 14: Shirley Cristina Muniz
INSERT INTO users (id, subject_type, email, email_normalized, status, auth_epoch, created_at, updated_at) VALUES (14, 'human', NULL, NULL, 'pending_setup', 1, unixepoch(), unixepoch());
INSERT INTO user_profiles (user_id, username, username_normalized, display_name, profile_visibility, is_discoverable, created_at, updated_at) VALUES (14, 'shirley_muniz', 'shirley_muniz', 'Shirley Cristina Muniz', 'private', 0, unixepoch(), unixepoch());
INSERT INTO citizens (user_id, username, legal_first_name, legal_last_name, nationality_code, civil_status, created_at, updated_at) VALUES (14, 'citizen_shirley_muniz', 'Shirley Cristina', 'Muniz', 'BR', 'pending', unixepoch(), unixepoch());
INSERT INTO user_roles (user_id, role_id, grant_source, granted_by, version, created_at, updated_at) VALUES (14, 2, 'admin', 6, 1, unixepoch(), unixepoch());

-- Associado ID 15: Doralice Moreira de Almeida Costa
INSERT INTO users (id, subject_type, email, email_normalized, status, auth_epoch, created_at, updated_at) VALUES (15, 'human', NULL, NULL, 'pending_setup', 1, unixepoch(), unixepoch());
INSERT INTO user_profiles (user_id, username, username_normalized, display_name, profile_visibility, is_discoverable, created_at, updated_at) VALUES (15, 'doralice_costa', 'doralice_costa', 'Doralice Moreira de Almeida Costa', 'private', 0, unixepoch(), unixepoch());
INSERT INTO citizens (user_id, username, legal_first_name, legal_last_name, nationality_code, civil_status, created_at, updated_at) VALUES (15, 'citizen_doralice_costa', 'Doralice', 'Moreira de Almeida Costa', 'BR', 'pending', unixepoch(), unixepoch());
INSERT INTO user_roles (user_id, role_id, grant_source, granted_by, version, created_at, updated_at) VALUES (15, 2, 'admin', 6, 1, unixepoch(), unixepoch());

-- Associado ID 16: Alessandra Pereira Teixeira
INSERT INTO users (id, subject_type, email, email_normalized, status, auth_epoch, created_at, updated_at) VALUES (16, 'human', NULL, NULL, 'pending_setup', 1, unixepoch(), unixepoch());
INSERT INTO user_profiles (user_id, username, username_normalized, display_name, profile_visibility, is_discoverable, created_at, updated_at) VALUES (16, 'alessandra_teixeira', 'alessandra_teixeira', 'Alessandra Pereira Teixeira', 'private', 0, unixepoch(), unixepoch());
INSERT INTO citizens (user_id, username, legal_first_name, legal_last_name, nationality_code, civil_status, created_at, updated_at) VALUES (16, 'citizen_alessandra_teixeira', 'Alessandra', 'Pereira Teixeira', 'BR', 'pending', unixepoch(), unixepoch());
INSERT INTO user_roles (user_id, role_id, grant_source, granted_by, version, created_at, updated_at) VALUES (16, 2, 'admin', 6, 1, unixepoch(), unixepoch());

-- Associado ID 17: Patricia Rodrigues Carneiro
INSERT INTO users (id, subject_type, email, email_normalized, status, auth_epoch, created_at, updated_at) VALUES (17, 'human', NULL, NULL, 'pending_setup', 1, unixepoch(), unixepoch());
INSERT INTO user_profiles (user_id, username, username_normalized, display_name, profile_visibility, is_discoverable, created_at, updated_at) VALUES (17, 'patricia_carneiro', 'patricia_carneiro', 'Patricia Rodrigues Carneiro', 'private', 0, unixepoch(), unixepoch());
INSERT INTO citizens (user_id, username, legal_first_name, legal_last_name, nationality_code, civil_status, created_at, updated_at) VALUES (17, 'citizen_patricia_carneiro', 'Patricia', 'Rodrigues Carneiro', 'BR', 'pending', unixepoch(), unixepoch());
INSERT INTO user_roles (user_id, role_id, grant_source, granted_by, version, created_at, updated_at) VALUES (17, 2, 'admin', 6, 1, unixepoch(), unixepoch());

-- Associado ID 18: João Nunes de Mesquita
INSERT INTO users (id, subject_type, email, email_normalized, status, auth_epoch, created_at, updated_at) VALUES (18, 'human', NULL, NULL, 'pending_setup', 1, unixepoch(), unixepoch());
INSERT INTO user_profiles (user_id, username, username_normalized, display_name, profile_visibility, is_discoverable, created_at, updated_at) VALUES (18, 'joao_mesquita', 'joao_mesquita', 'João Nunes de Mesquita', 'private', 0, unixepoch(), unixepoch());
INSERT INTO citizens (user_id, username, legal_first_name, legal_last_name, nationality_code, civil_status, created_at, updated_at) VALUES (18, 'citizen_joao_mesquita', 'João', 'Nunes de Mesquita', 'BR', 'pending', unixepoch(), unixepoch());
INSERT INTO user_roles (user_id, role_id, grant_source, granted_by, version, created_at, updated_at) VALUES (18, 2, 'admin', 6, 1, unixepoch(), unixepoch());

-- Associado ID 19: Paulo dos Santos Rosa
INSERT INTO users (id, subject_type, email, email_normalized, status, auth_epoch, created_at, updated_at) VALUES (19, 'human', NULL, NULL, 'pending_setup', 1, unixepoch(), unixepoch());
INSERT INTO user_profiles (user_id, username, username_normalized, display_name, profile_visibility, is_discoverable, created_at, updated_at) VALUES (19, 'paulo_rosa', 'paulo_rosa', 'Paulo dos Santos Rosa', 'private', 0, unixepoch(), unixepoch());
INSERT INTO citizens (user_id, username, legal_first_name, legal_last_name, nationality_code, civil_status, created_at, updated_at) VALUES (19, 'citizen_paulo_rosa', 'Paulo', 'dos Santos Rosa', 'BR', 'pending', unixepoch(), unixepoch());
INSERT INTO user_roles (user_id, role_id, grant_source, granted_by, version, created_at, updated_at) VALUES (19, 2, 'admin', 6, 1, unixepoch(), unixepoch());

-- Associado ID 20: Thaiana Carvalho da Silva
INSERT INTO users (id, subject_type, email, email_normalized, status, auth_epoch, created_at, updated_at) VALUES (20, 'human', NULL, NULL, 'pending_setup', 1, unixepoch(), unixepoch());
INSERT INTO user_profiles (user_id, username, username_normalized, display_name, profile_visibility, is_discoverable, created_at, updated_at) VALUES (20, 'thaiana_silva', 'thaiana_silva', 'Thaiana Carvalho da Silva', 'private', 0, unixepoch(), unixepoch());
INSERT INTO citizens (user_id, username, legal_first_name, legal_last_name, nationality_code, civil_status, created_at, updated_at) VALUES (20, 'citizen_thaiana_silva', 'Thaiana', 'Carvalho da Silva', 'BR', 'pending', unixepoch(), unixepoch());
INSERT INTO user_roles (user_id, role_id, grant_source, granted_by, version, created_at, updated_at) VALUES (20, 2, 'admin', 6, 1, unixepoch(), unixepoch());

-- Associado ID 21: Maria Cecília Magalhães de Moura
INSERT INTO users (id, subject_type, email, email_normalized, status, auth_epoch, created_at, updated_at) VALUES (21, 'human', NULL, NULL, 'pending_setup', 1, unixepoch(), unixepoch());
INSERT INTO user_profiles (user_id, username, username_normalized, display_name, profile_visibility, is_discoverable, created_at, updated_at) VALUES (21, 'maria_moura', 'maria_moura', 'Maria Cecília Magalhães de Moura', 'private', 0, unixepoch(), unixepoch());
INSERT INTO citizens (user_id, username, legal_first_name, legal_last_name, nationality_code, civil_status, created_at, updated_at) VALUES (21, 'citizen_maria_moura', 'Maria Cecília', 'Magalhães de Moura', 'BR', 'pending', unixepoch(), unixepoch());
INSERT INTO user_roles (user_id, role_id, grant_source, granted_by, version, created_at, updated_at) VALUES (21, 2, 'admin', 6, 1, unixepoch(), unixepoch());