# Nota Normativa de Sequenciamento de Migrações — 0003

> **Identificador:** MIGRATION-0003-SKIP
> **Status:** RESERVADA / NÃO APLICADA EM PRODUÇÃO
> **Data de Registro:** 2026-09-16

## Contexto

A sequência de arquivos de migração DDL gerenciados pelo Drizzle apresenta um salto numérico entre:
- `0002_solid_barracuda.sql`
- `0004_preflight_audit.sql`

A versão `0003` correspondeu a uma migração preliminar experimental de auditoria que foi consolidada diretamente no script `0004_preflight_audit.sql` antes de ser promovida aos ambientes estáveis.

## Decisão de Engenharia

Para preservar o princípio de **imutabilidade do histórico de migrações aplicadas** e não reescrever a árvore nem reordenar os hashes de `_journal.json`, a lacuna `0003` foi documentada formalmente e mantida como saltada (*intentionally skipped*).
