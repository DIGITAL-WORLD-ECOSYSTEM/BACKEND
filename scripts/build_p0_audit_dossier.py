#!/usr/bin/env python3
import os

WORKSPACE_DIR = "/home/sandro/Área de trabalho/BackEnd"
ARTIFACT_DIR = "/home/sandro/.gemini/antigravity-ide/brain/e24f441b-e2c2-46f6-a29f-45a33b89eedf"

P0_FILES = [
    ("src/infrastructure/repositories/DrizzleUnitOfWork.ts", "Atomicidade real das mutações: transaction boundary, rollback, falha entre queries, commit failure, interação com D1/DO"),
    ("src/infrastructure/repositories/DrizzleFinanceRepository.ts", "Persistência completa de todas as mutations + propagação de actor_user_id, authorized_by_user_id, source_type, correlation_id"),
    ("src/application/finance/use-cases/RecordTransferUseCase.ts", "Isolamento de custódia, ownership, limites de origem/destino, autorização e bloqueio de P2P indevido"),
    ("src/application/finance/services/FinancialTransactionOrchestrator.ts", "Fechamento da cadeia inteira: idempotência → domínio → OCC → ledger → balance → outbox → auditoria"),
    ("src/infrastructure/services/EventInboxService.ts", "Crash/retry/lease expiry; garantir consumidor idempotente e transição de estado segura"),
    ("src/infrastructure/services/FinanceBootstrapService.ts", "Garantir que bootstrap nunca inicialize/altere produção indevidamente e seja explicitamente condicionado ao ambiente"),
    ("migrations/0011_treasury_singleton_and_forensic_audit.sql", "Confirmar que o modelo físico da auditoria forense corresponde exatamente ao que o código grava"),
    ("migrations/0012_finance_p0_hardening.sql", "[COMPANION P0] Enforce physical append-only triggers, leg ordinal, SQL assertion guard and system routes"),
    ("src/db/finance/tables.ts", "Constraints definitivas, unicidade, FK, status, versões, valores, cardinalidade e proteção do ledger"),
    ("src/application/ports/output/IUnitOfWork.ts", "Contrato da UoW precisa representar a semântica transacional real que a infraestrutura efetivamente consegue entregar"),
    ("src/application/ports/output/IFinanceRepository.ts", "Contrato precisa contemplar todas as mutations e metadados forenses exigidos"),
    ("src/application/ports/output/IOutboxRepository.ts", "Garantir atomicidade lógica com a UoW e contrato de publicação/reprocessamento"),
    ("src/infrastructure/repositories/DrizzleOutboxRepository.ts", "Revalidar a afirmação de 'transacional' em conjunto com a nova UoW")
]

def main():
    doc_lines = []
    doc_lines.append("# Dossiê de Código Fonte — Auditoria P0 Finance Core\n")
    doc_lines.append("Este documento consolida o código-fonte **100% integral, real e sem cortes** dos 12 arquivos prioritários **P0** para a 1ª etapa de auditoria e saneamento do core financeiro (`BackEnd/`).\n")
    doc_lines.append("## Índice de Arquivos P0\n")

    for i, (rel_path, reason) in enumerate(P0_FILES, 1):
        full_path = os.path.join(WORKSPACE_DIR, rel_path)
        with open(full_path, "r", errors="ignore") as fp:
            line_count = len(fp.readlines())
        anchor = rel_path.replace("/", "_").replace(".", "_")
        doc_lines.append(f"{i}. [{os.path.basename(rel_path)}](#{anchor}) (`{rel_path}`) — *{line_count} linhas*")
        doc_lines.append(f"   - **Foco de Fechamento**: {reason}\n")

    doc_lines.append("\n---\n")

    for i, (rel_path, reason) in enumerate(P0_FILES, 1):
        anchor = rel_path.replace("/", "_").replace(".", "_")
        full_path = os.path.join(WORKSPACE_DIR, rel_path)
        with open(full_path, "r", errors="ignore") as fp:
            content = fp.read()
        lines_count = len(content.splitlines())
        ext = "sql" if rel_path.endswith(".sql") else "typescript"

        doc_lines.append(f'<a id="{anchor}"></a>')
        doc_lines.append(f"## {i}. `{rel_path}`\n")
        doc_lines.append(f"- **Caminho absoluto**: `{full_path}`")
        doc_lines.append(f"- **Total de linhas**: {lines_count}")
        doc_lines.append(f"- **O que precisa ser fechado**: {reason}\n")
        doc_lines.append(f"```{ext}")
        doc_lines.append(content)
        doc_lines.append("```\n")
        doc_lines.append("\n---\n")

    final_content = "\n".join(doc_lines)

    output_docs = os.path.join(WORKSPACE_DIR, "docs/FINANCE_P0_AUDIT_SOURCE_CODE.md")
    with open(output_docs, "w", encoding="utf-8") as fp:
        fp.write(final_content)

    os.makedirs(ARTIFACT_DIR, exist_ok=True)
    output_artifact = os.path.join(ARTIFACT_DIR, "p0_audit_dossier.md")
    with open(output_artifact, "w", encoding="utf-8") as fp:
        fp.write(final_content)

    print(f"Sucesso! Gerado {output_docs} ({len(final_content)} bytes)")
    print(f"Sucesso! Gerado {output_artifact} ({len(final_content)} bytes)")

if __name__ == "__main__":
    main()
