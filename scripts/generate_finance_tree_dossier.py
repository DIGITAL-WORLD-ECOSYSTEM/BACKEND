import os

tree_structure = [
    {
        'layer': '1. CAMADA DE DOMÍNIO (Regras Contábeis Puras)',
        'dir': 'src/domains/finance',
        'files': [
            'src/domains/finance/contracts/FinancialLedgerEntryRecord.ts',
            'src/domains/finance/entities/FinancialTransaction.test.ts',
            'src/domains/finance/entities/LedgerTransaction.ts',
            'src/domains/finance/errors/FinancialError.ts',
            'src/domains/finance/errors/LedgerImbalanceError.ts',
            'src/domains/finance/policies/AccountClassPolicy.ts',
            'src/domains/finance/policies/AccountingEntryPolicy.ts',
            'src/domains/finance/policies/AccountStatusPolicy.ts',
            'src/domains/finance/policies/AssetStatusPolicy.ts',
            'src/domains/finance/services/FinancialTransactionStateMachine.ts',
            'src/domains/finance/value-objects/BaseUnits.ts',
            'src/domains/finance/value-objects/Money256.ts'
        ]
    },
    {
        'layer': '2. CAMADA DE APLICAÇÃO (Casos de Uso e Orquestração)',
        'dir': 'src/application/finance',
        'files': [
            'src/application/finance/services/CanonicalRequestHashService.ts',
            'src/application/finance/services/FinancialTransactionOrchestrator.ts',
            'src/application/finance/use-cases/GetTreasuryBalanceUseCase.ts',
            'src/application/finance/use-cases/RecordDepositUseCase.ts',
            'src/application/finance/use-cases/RecordLedgerTransactionUseCase.ts',
            'src/application/finance/use-cases/RecordTransferUseCase.ts',
            'src/application/finance/use-cases/RecordTreasuryTransactionUseCase.ts',
            'src/application/finance/use-cases/RepairFinanceUseCase.ts',
            'src/application/finance/use-cases/ReverseTransactionUseCase.ts',
            'src/application/ports/output/IFinanceRepository.ts'
        ]
    },
    {
        'layer': '3. CAMADA DE INFRAESTRUTURA (Repositórios e Bootstrap)',
        'dir': 'src/infrastructure',
        'files': [
            'src/infrastructure/repositories/DrizzleFinanceRepository.ts',
            'src/infrastructure/repositories/DrizzleFinanceRepository.test.ts',
            'src/infrastructure/services/FinanceBootstrapService.ts'
        ]
    },
    {
        'layer': '4. ESQUEMA DE BANCO DE DADOS (D1 / SQLite Tables)',
        'dir': 'src/db/finance',
        'files': [
            'src/db/finance/tables.ts',
            'src/db/finance/relations.ts'
        ]
    },
    {
        'layer': '5. CAMADA DE APRESENTAÇÃO HTTP / REST',
        'dir': 'src/interfaces/http',
        'files': [
            'src/interfaces/http/controllers/finance/FinanceController.ts',
            'src/interfaces/http/routes/finance/finance.routes.ts'
        ]
    },
    {
        'layer': '6. SUÍTES DE TESTES AUTOMATIZADOS',
        'dir': 'tests',
        'files': [
            'tests/architecture/finance_posting_authority.test.ts',
            'tests/finance_real_db_e2e.test.ts',
            'tests/finance/bootstrap_service.test.ts',
            'tests/finance/concurrency_stress.test.ts',
            'tests/finance/domain_policies.test.ts',
            'tests/finance/event_inbox.test.ts',
            'tests/finance/evm_precision.test.ts',
            'tests/finance/failure_injection.test.ts',
            'tests/finance/money256.test.ts',
            'tests/finance/posting_authority_hardening.test.ts',
            'tests/finance/reconciliation_3way.test.ts',
            'tests/finance/reverse_transaction.test.ts',
            'tests/finance/invariants/balance_projection.test.ts',
            'tests/finance/invariants/commit_failure.test.ts',
            'tests/finance/invariants/transaction_failure_matrix.test.ts'
        ]
    }
]

os.makedirs('docs/finance_layers', exist_ok=True)

master_path = 'docs/FINANCE_CORE_COMPLETE_TREE.md'
total_files = 0
total_lines = 0

layer_slugs = [
    '01_camada_de_dominio',
    '02_camada_de_aplicacao',
    '03_camada_de_infraestrutura',
    '04_esquema_de_banco_de_dados',
    '05_camada_de_apresentacao_http',
    '06_suites_de_testes_automatizados'
]

with open(master_path, 'w', encoding='utf-8') as master:
    master.write('# Finance Core — Código Completo Canônico da Árvore\n\n')
    master.write('Este documento consolida o código-fonte **100% integral, real e sem omissões** de cada um dos 44 arquivos da árvore oficial do subsistema financeiro (`BackEnd/`), organizados estritamente pela arquitetura canônica em camadas.\n\n')
    master.write('## Índice Geral da Árvore\n\n')
    
    for idx, section in enumerate(tree_structure):
        master.write(f'### {section["layer"]}\n\n')
        for fpath in section['files']:
            fname = os.path.basename(fpath)
            lines_in_f = sum(1 for _ in open(fpath, 'r', encoding='utf-8'))
            anchor = fpath.replace('/', '').replace('.', '').replace('-', '').lower()
            master.write(f'- [{fname}](#{anchor}) (`{fpath}`) — *{lines_in_f} linhas*\n')
        master.write('\n')
    
    master.write('---\n\n')
    
    for idx, section in enumerate(tree_structure):
        layer_name = section['layer']
        layer_file_path = f'docs/finance_layers/{layer_slugs[idx]}.md'
        
        with open(layer_file_path, 'w', encoding='utf-8') as layer_file:
            layer_file.write(f'# {layer_name}\n\n')
            layer_file.write(f'Documento integrante do dossiê canônico do Finance Core (`BackEnd/`).\n\n')
            layer_file.write('## Sumário dos Arquivos da Camada\n\n')
            
            for fpath in section['files']:
                fname = os.path.basename(fpath)
                lines_in_f = sum(1 for _ in open(fpath, 'r', encoding='utf-8'))
                anchor = fpath.replace('/', '').replace('.', '').replace('-', '').lower()
                layer_file.write(f'- [{fname}](#{anchor}) — `{fpath}` ({lines_in_f} linhas)\n')
            
            layer_file.write('\n---\n\n')
            
            for fpath in section['files']:
                with open(fpath, 'r', encoding='utf-8') as src:
                    content = src.read()
                    lines = content.count('\n') + (1 if content and not content.endswith('\n') else 0)
                
                total_files += 1
                total_lines += lines
                
                anchor = fpath.replace('/', '').replace('.', '').replace('-', '').lower()
                header = (
                    f'<a id="{anchor}"></a>\n'
                    f'## Arquivo: `{fpath}`\n\n'
                    f'- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/{fpath}`\n'
                    f'- **Total de linhas**: {lines}\n'
                    f'- **Linguagem**: TypeScript\n\n'
                    f'```typescript\n{content}\n```\n\n'
                    f'---\n\n'
                )
                master.write(header)
                layer_file.write(header)

print(f'Concluído com sucesso!')
print(f'Total de arquivos processados: {total_files}')
print(f'Total de linhas de código: {total_lines}')
