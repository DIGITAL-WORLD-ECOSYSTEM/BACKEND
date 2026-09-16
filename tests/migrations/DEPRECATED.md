# Documentação de Depreciação — tests/migrations/

> **Status:** DEPRECIADO (Código Histórico Preservado)
> **Data de Marcação:** 2026-09-16
> **Fonte Canônica Ativa:** [`/migrations/`](../../migrations/)

## Motivação e Contexto

Os arquivos contidos neste diretório (`0000_white_raider.sql`, `meta/`) representam um snapshot de migrações gerado durante testes iniciais do projeto.

Para evitar divergência de esquema entre ambientes de teste e produção, o helper de execução de testes de banco ([`tests/test_helpers/runMigrations.ts`](../test_helpers/runMigrations.ts)) foi unificado para consumir **exclusivamente a pasta canônica `/migrations/`** na raiz do repositório.

## Diretriz de Preservação

- **Não excluir:** Estes arquivos foram mantidos intactos para garantir rastreabilidade histórica e não quebrar ferramentas externas ou scripts passivos.
- **Não alterar:** Qualquer nova alteração ou adição de DDL deve ser realizada estritamente dentro da pasta `/migrations/` na raiz do projeto.
