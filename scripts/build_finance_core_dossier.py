#!/usr/bin/env python3
import os
import datetime

WORKSPACE_DIR = "/home/sandro/Área de trabalho/BackEnd"
OUTPUT_DOC = os.path.join(WORKSPACE_DIR, "docs/generated/FINANCE_CORE_ALL_CODE.txt")
ARTIFACT_DOC = "/home/sandro/.gemini/antigravity-ide/brain/9382e3c4-2aae-414c-b645-466ee1a94876/finance_core_full_source.txt"

# 1. Main Finance Files in Tree Order
# A. DOMAIN
domain_files = [
    "src/domains/finance/contracts/FinancialLedgerEntryRecord.ts",
    "src/domains/finance/entities/FinancialTransaction.test.ts",
    "src/domains/finance/entities/LedgerTransaction.ts",
    "src/domains/finance/errors/FinancialError.ts",
    "src/domains/finance/errors/LedgerImbalanceError.ts",
    "src/domains/finance/policies/AccountClassPolicy.ts",
    "src/domains/finance/policies/AccountingEntryPolicy.ts",
    "src/domains/finance/policies/AccountStatusPolicy.ts",
    "src/domains/finance/policies/AssetStatusPolicy.ts",
    "src/domains/finance/services/FinancialTransactionStateMachine.ts",
    "src/domains/finance/value-objects/BaseUnits.ts",
    "src/domains/finance/value-objects/Money256.ts",
]

# B. APPLICATION
application_files = [
    "src/application/finance/services/CanonicalRequestHashService.ts",
    "src/application/finance/services/FinancialTransactionOrchestrator.ts",
    "src/application/finance/use-cases/GetTreasuryBalanceUseCase.ts",
    "src/application/finance/use-cases/RecordDepositUseCase.ts",
    "src/application/finance/use-cases/RecordLedgerTransactionUseCase.ts",
    "src/application/finance/use-cases/RecordTransferUseCase.ts",
    "src/application/finance/use-cases/RecordTreasuryTransactionUseCase.ts",
    "src/application/finance/use-cases/RepairFinanceUseCase.ts",
    "src/application/finance/use-cases/ReverseTransactionUseCase.ts",
    "src/application/ports/output/IFinanceRepository.ts",
    "src/application/ports/output/IUnitOfWork.ts",
]

# C. INFRASTRUCTURE
infrastructure_files = [
    "src/infrastructure/repositories/DrizzleFinanceRepository.ts",
    "src/infrastructure/repositories/DrizzleFinanceRepository.test.ts",
    "src/infrastructure/repositories/DrizzleUnitOfWork.ts",
    "src/infrastructure/repositories/DrizzleUnitOfWork.test.ts",
    "src/infrastructure/repositories/DrizzleOutboxRepository.ts",
    "src/infrastructure/services/FinanceBootstrapService.ts",
    "src/infrastructure/services/EventInboxService.ts",
]

# D. HTTP
http_files = [
    "src/interfaces/http/controllers/finance/FinanceController.ts",
    "src/interfaces/http/routes/finance/finance.routes.ts",
]

# E. DATABASE
db_files = [
    "src/db/finance/tables.ts",
    "src/db/finance/relations.ts",
    "src/db/seed.sql",
    "src/db/seed_treasury_report.sql",
]

# F. MIGRATIONS
migration_files = [
    "migrations/0000_white_raider.sql",
    "migrations/0005_data_remediation.sql",
    "migrations/0006_constraints.sql",
    "migrations/0007_event_inbox.sql",
    "migrations/0008_remediation_schema.sql",
    "migrations/0009_finance_schema_alignment.sql",
]

# G. TESTS
test_files = [
    "tests/finance/bootstrap_service.test.ts",
    "tests/finance/concurrency_stress.test.ts",
    "tests/finance/domain_policies.test.ts",
    "tests/finance/event_inbox.test.ts",
    "tests/finance/evm_precision.test.ts",
    "tests/finance/failure_injection.test.ts",
    "tests/finance/invariants/balance_projection.test.ts",
    "tests/finance/invariants/commit_failure.test.ts",
    "tests/finance/invariants/seeds_normal_balance.test.ts",
    "tests/finance/invariants/transaction_failure_matrix.test.ts",
    "tests/finance/money256.test.ts",
    "tests/finance/posting_authority_hardening.test.ts",
    "tests/finance/reconciliation_3way.test.ts",
    "tests/finance/reverse_transaction.test.ts",
    "tests/finance/schema_invariants_audit.test.ts",
    "tests/finance_real_db_e2e.test.ts",
    "tests/architecture/finance_posting_authority.test.ts",
    "tests/architecture/architecture-boundaries.test.ts",
    "tests/architecture/dependency_rules.test.ts",
    "tests/migrations/migration_integrity.test.ts",
    "tests/test_helpers/runMigrations.ts",
]

# H. DIRECT DEPENDENCIES (Outside main Finance tree)
dependencies_info = [
    {
        "path": "src/db/schema.ts",
        "reason": "Ponto central de exportação de todo o schema do Drizzle ORM do backend; consolida e reexporta as tabelas do Finance (src/db/finance/tables.ts), relações (relations.ts) e infraestrutura (src/db/infrastructure/tables.ts) para a conexão do banco de dados D1/SQLite."
    },
    {
        "path": "src/db/index.ts",
        "reason": "Instanciação e injeção do cliente Drizzle D1 (DrizzleD1Database), tipos de conexão e binding de contexto utilizado pelo DrizzleFinanceRepository, DrizzleUnitOfWork e FinanceBootstrapService."
    },
    {
        "path": "src/db/infrastructure/tables.ts",
        "reason": "Define a tabela de banco de dados física event_inbox e a tabela outbox, manipuladas diretamente pelo EventInboxService e DrizzleOutboxRepository para garantia de idempotência e processamento transactional outbox do Finance."
    },
    {
        "path": "src/application/ports/output/IOutboxRepository.ts",
        "reason": "Contrato da porta de saída de persistência transacional de eventos de domínio no outbox, acoplado ao ciclo de vida de commit atômico do IUnitOfWork durante o registro de transações financeiras."
    },
    {
        "path": "src/shared/kernel/Result.ts",
        "reason": "Padrão canônico de retorno funcional monádico (Result<T, E>, ok(), err()) empregado universalmente em toda a camada de domínio, casos de uso e repositórios do Finance para tratamento robusto de erros sem lançamento de exceções descontroladas."
    },
    {
        "path": "src/shared/kernel/DomainEvent.ts",
        "reason": "Estrutura base e interface tipada para todos os eventos de domínio emitidos pelo subsistema contábil (como LedgerEntryPostedEvent), consumidos por orquestradores e mensageria."
    },
    {
        "path": "src/shared/kernel/RepositoryError.ts",
        "reason": "Hierarquia canônica de erros de persistência (erros de concorrência otimista, constraints de chave única, falhas de conexão de infraestrutura) mapeados e tratados pelo DrizzleFinanceRepository e DrizzleUnitOfWork."
    },
    {
        "path": "src/shared/kernel/ids/UserId.ts",
        "reason": "Value Object de tipagem nominal forte de identificador de usuário (UserId), utilizado nas contas de custódia e titularidade de saldos do Finance (accountId, ownerId)."
    },
    {
        "path": "src/infrastructure/repositories/db_helper.ts",
        "reason": "Utilitário de conexão e resolução de driver de banco de dados compartilhado pela infraestrutura de persistência do Drizzle no ambiente Cloudflare Workers/D1 e SQLite local."
    },
    {
        "path": "docs/adr/0001-posting-authority-and-repair-governance.md",
        "reason": "Registro Arquitetural Decisório (ADR 0001) normativo que estipula formalmente o isolamento contábil, autoridade única de postagem (FinancialTransactionOrchestrator), proibição de mutação direta de saldos e governança da ferramenta de reparo (RepairFinanceUseCase)."
    }
]

main_files = (
    domain_files +
    application_files +
    infrastructure_files +
    http_files +
    db_files +
    migration_files +
    test_files
)

total_main_files = len(main_files)
total_dep_files = len(dependencies_info)
total_all_files = total_main_files + total_dep_files

# Verify all exist
for f in main_files:
    full = os.path.join(WORKSPACE_DIR, f)
    if not os.path.exists(full):
        raise FileNotFoundError(f"File does not exist: {full}")

for d in dependencies_info:
    full = os.path.join(WORKSPACE_DIR, d["path"])
    if not os.path.exists(full):
        raise FileNotFoundError(f"Dependency file does not exist: {full}")

print(f"Total main files: {total_main_files}")
print(f"Total dependencies: {total_dep_files}")
print(f"Grand total files: {total_all_files}")

now_iso = datetime.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %z")

def count_lines(filepath):
    with open(filepath, "r", encoding="utf-8") as fp:
        return sum(1 for _ in fp)

total_lines = 0
for f in main_files:
    total_lines += count_lines(os.path.join(WORKSPACE_DIR, f))
for d in dependencies_info:
    total_lines += count_lines(os.path.join(WORKSPACE_DIR, d["path"]))

print(f"Total lines across all 71 files: {total_lines}")

out_lines = []

# HEADER
out_lines.append("================================================================================")
out_lines.append("FINANCE CORE — CÓDIGO-FONTE COMPLETO")
out_lines.append("================================================================================")
out_lines.append("")
out_lines.append(f"PROJETO: {WORKSPACE_DIR}")
out_lines.append(f"DATA DA EXTRAÇÃO: {now_iso}")
out_lines.append("")
out_lines.append("================================================================================")
out_lines.append("ÁRVORE REAL DO FINANCE")
out_lines.append("================================================================================")
out_lines.append("")

real_tree_str = """src/
├── domains/
│   └── finance/
│       ├── contracts/
│       │   └── FinancialLedgerEntryRecord.ts
│       ├── entities/
│       │   ├── FinancialTransaction.test.ts
│       │   └── LedgerTransaction.ts
│       ├── errors/
│       │   ├── FinancialError.ts
│       │   └── LedgerImbalanceError.ts
│       ├── policies/
│       │   ├── AccountClassPolicy.ts
│       │   ├── AccountingEntryPolicy.ts
│       │   ├── AccountStatusPolicy.ts
│       │   └── AssetStatusPolicy.ts
│       ├── services/
│       │   └── FinancialTransactionStateMachine.ts
│       └── value-objects/
│           ├── BaseUnits.ts
│           └── Money256.ts
├── application/
│   ├── finance/
│   │   ├── services/
│   │   │   ├── CanonicalRequestHashService.ts
│   │   │   └── FinancialTransactionOrchestrator.ts
│   │   └── use-cases/
│   │       ├── GetTreasuryBalanceUseCase.ts
│   │       ├── RecordDepositUseCase.ts
│   │       ├── RecordLedgerTransactionUseCase.ts
│   │       ├── RecordTransferUseCase.ts
│   │       ├── RecordTreasuryTransactionUseCase.ts
│   │       ├── RepairFinanceUseCase.ts
│   │       └── ReverseTransactionUseCase.ts
│   └── ports/
│       └── output/
│           ├── IFinanceRepository.ts
│           └── IUnitOfWork.ts
├── infrastructure/
│   ├── repositories/
│   │   ├── DrizzleFinanceRepository.ts
│   │   ├── DrizzleFinanceRepository.test.ts
│   │   ├── DrizzleUnitOfWork.ts
│   │   ├── DrizzleUnitOfWork.test.ts
│   │   └── DrizzleOutboxRepository.ts
│   └── services/
│       ├── FinanceBootstrapService.ts
│       └── EventInboxService.ts
├── interfaces/
│   └── http/
│       ├── controllers/
│       │   └── finance/
│       │       └── FinanceController.ts
│       └── routes/
│           └── finance/
│               └── finance.routes.ts
├── db/
│   ├── finance/
│   │   ├── tables.ts
│   │   └── relations.ts
│   ├── seed.sql
│   └── seed_treasury_report.sql
migrations/
├── 0000_white_raider.sql
├── 0005_data_remediation.sql
├── 0006_constraints.sql
├── 0007_event_inbox.sql
├── 0008_remediation_schema.sql
└── 0009_finance_schema_alignment.sql
tests/
├── finance/
│   ├── bootstrap_service.test.ts
│   ├── concurrency_stress.test.ts
│   ├── domain_policies.test.ts
│   ├── event_inbox.test.ts
│   ├── evm_precision.test.ts
│   ├── failure_injection.test.ts
│   ├── invariants/
│   │   ├── balance_projection.test.ts
│   │   ├── commit_failure.test.ts
│   │   ├── seeds_normal_balance.test.ts
│   │   └── transaction_failure_matrix.test.ts
│   ├── money256.test.ts
│   ├── posting_authority_hardening.test.ts
│   ├── reconciliation_3way.test.ts
│   ├── reverse_transaction.test.ts
│   └── schema_invariants_audit.test.ts
├── architecture/
│   ├── finance_posting_authority.test.ts
│   ├── architecture-boundaries.test.ts
│   └── dependency_rules.test.ts
├── migrations/
│   └── migration_integrity.test.ts
├── test_helpers/
│   └── runMigrations.ts
└── finance_real_db_e2e.test.ts"""

out_lines.append(real_tree_str)
out_lines.append("")

# SECOND BLOCK: CÓDIGO COMPLETO
out_lines.append("================================================================================")
out_lines.append("CÓDIGO-FONTE INTEGRAL — SUBSISTEMA FINANCE")
out_lines.append("================================================================================")
out_lines.append("")

file_idx = 1
for rel_path in main_files:
    full_path = os.path.join(WORKSPACE_DIR, rel_path)
    out_lines.append("================================================================================")
    out_lines.append(f"ARQUIVO [{file_idx}/{total_main_files}]: {rel_path}")
    out_lines.append(f"CAMINHO ABSOLUTO: {full_path}")
    out_lines.append("================================================================================")
    with open(full_path, "r", encoding="utf-8") as fp:
        content = fp.read()
    out_lines.append(content)
    if not content.endswith("\n"):
        out_lines.append("")
    out_lines.append("")
    file_idx += 1

# DEPENDÊNCIAS DIRETAS
out_lines.append("================================================================================")
out_lines.append("DEPENDÊNCIAS DIRETAS DO FINANCE")
out_lines.append("================================================================================")
out_lines.append("")

for idx, dep in enumerate(dependencies_info, 1):
    rel_path = dep["path"]
    full_path = os.path.join(WORKSPACE_DIR, rel_path)
    out_lines.append(f"DEPENDÊNCIA [{idx}/{total_dep_files}]: {rel_path}")
    out_lines.append(f"CAMINHO: {full_path}")
    out_lines.append(f"MOTIVO DA INCLUSÃO: {dep['reason']}")
    out_lines.append(f"ARQUIVO:")
    out_lines.append("--------------------------------------------------------------------------------")
    with open(full_path, "r", encoding="utf-8") as fp:
        content = fp.read()
    out_lines.append(content)
    if not content.endswith("\n"):
        out_lines.append("")
    out_lines.append("--------------------------------------------------------------------------------")
    out_lines.append("")

# INVENTÁRIO FINAL
out_lines.append("================================================================================")
out_lines.append("INVENTÁRIO FINAL")
out_lines.append("================================================================================")
out_lines.append("")
out_lines.append(f"Arquivos Finance principais:")
out_lines.append(f"{len(domain_files) + len(application_files) + len(infrastructure_files) + len(http_files) + len(db_files)}")
out_lines.append("")
out_lines.append(f"Dependências diretas incluídas:")
out_lines.append(f"{len(dependencies_info)}")
out_lines.append("")
out_lines.append(f"Testes Finance:")
out_lines.append(f"{len(test_files)}")
out_lines.append("")
out_lines.append(f"Migrations relacionadas:")
out_lines.append(f"{len(migration_files)}")
out_lines.append("")
out_lines.append(f"Total de arquivos extraídos:")
out_lines.append(f"{total_all_files}")
out_lines.append("")
out_lines.append(f"Total de linhas extraídas:")
out_lines.append(f"{total_lines}")
out_lines.append("")

# DETECÇÃO DE INCONSISTÊNCIAS
out_lines.append("================================================================================")
out_lines.append("MAPA DE POSSÍVEIS INCONSISTÊNCIAS DETECTADAS DURANTE A EXTRAÇÃO")
out_lines.append("================================================================================")
out_lines.append("")
inconsistencies = [
    "- Caso de Uso de Reparo Desconectado: O arquivo src/application/finance/use-cases/RepairFinanceUseCase.ts implementa a governança e execução de reparos de dados financeiros (conforme ADR 0001), porém não está exposto em nenhuma rota HTTP em src/interfaces/http/routes/finance/finance.routes.ts nem injetado em FinanceController.ts, sendo acionado apenas por suítes de teste de integração.",
    "- Arquivos de Teste no Diretório de Código-Fonte: Três arquivos de teste automatizado (src/domains/finance/entities/FinancialTransaction.test.ts, src/infrastructure/repositories/DrizzleFinanceRepository.test.ts e src/infrastructure/repositories/DrizzleUnitOfWork.test.ts) residem fisicamente dentro da árvore de produção src/ em vez de estarem localizados sob a árvore canônica tests/.",
    "- Resolução de Import sem Extensão em Arquivo de Rotas: O arquivo src/interfaces/http/routes/finance/finance.routes.ts importa '../.../../types/bindings' sem extensão explícita, resolvendo fisicamente para a declaração de tipos src/types/bindings.d.ts.",
    "- Ausência de Pipeline de Ingestão de Extratos Bancários Reais: O módulo possui a tabela fiat_external_transactions com suporte a row_fingerprint e métodos no repositório, mas ainda não possui parsers de extrato bancário (OFX, CNAB 240/400 ou APIs bancárias de Bradesco, Cora ou Inter) implementados.",
    "- Defasagem Documental de Contagem de Arquivos: A documentação estática legada docs/FINANCE_CORE_COMPLETE_TREE.md registrava um escopo de 44 arquivos, enquanto a árvore física real e canônica do subsistema compreende 73 arquivos (63 principais + 10 dependências diretas, incluindo testes de arquitetura, integridade de migrations, scripts de seed e governança)."
]

for inc in inconsistencies:
    out_lines.append(inc)
out_lines.append("")
out_lines.append("================================================================================")
out_lines.append("FIM DO DOSSIÊ DO FINANCE CORE")
out_lines.append("================================================================================")

full_output_content = "\n".join(out_lines)

os.makedirs(os.path.dirname(OUTPUT_DOC), exist_ok=True)
with open(OUTPUT_DOC, "w", encoding="utf-8") as fp:
    fp.write(full_output_content)

os.makedirs(os.path.dirname(ARTIFACT_DOC), exist_ok=True)
with open(ARTIFACT_DOC, "w", encoding="utf-8") as fp:
    fp.write(full_output_content)

print(f"Sucesso! Dossiê gravado em:")
print(f"  -> {OUTPUT_DOC} ({os.path.getsize(OUTPUT_DOC)} bytes)")
print(f"  -> {ARTIFACT_DOC} ({os.path.getsize(ARTIFACT_DOC)} bytes)")
