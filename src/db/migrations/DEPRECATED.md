# Documentação de Depreciação — src/db/migrations/

> **Status:** DEPRECIADO (Código Histórico Preservado)
> **Data de Marcação:** 2026-09-16
> **Fonte Canônica Ativa:** [`/migrations/`](../../../migrations/)

## Motivação e Contexto

O arquivo `0002_add_domain_columns.up.sql` neste diretório é um fragmento DDL inicial de adição de colunas. Todas as migrações ativas e consolidadas são geradas pelo Drizzle Kit e residem na raiz do projeto em `/migrations/`.

## Diretriz de Preservação

- **Não excluir:** O arquivo é preservado para integridade histórica.
- **Desenvolvimento:** Nenhuma nova migração manual deve ser incluída neste diretório. Utilize o fluxo padrão do Drizzle (`drizzle-kit generate`).
