import { createHash } from 'crypto';

export type CanonicalPrimitive = string | number | boolean | null;
export type CanonicalValue =
  | CanonicalPrimitive
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

export class CanonicalRequestHashService {
  /**
   * Converte recursivamente um objeto/payload para formato JSON canônico:
   * 1. Ordena chaves de objetos alfabeticamente.
   * 2. Rejeita tipos não determinísticos (Date, Function, Symbol, undefined em arrays).
   * 3. Converte BigInt para representação de string decimal canônica.
   * 4. Garante representação determinística sem espaços de formatação.
   */
  public static canonicalize(obj: unknown): string {
    if (obj === null) {
      return 'null';
    }

    if (typeof obj === 'boolean') {
      return obj ? 'true' : 'false';
    }

    if (typeof obj === 'number') {
      if (!Number.isFinite(obj)) {
        throw new Error(`Erro de canonicalização: Número não-finito (${obj}) é proibido.`);
      }
      return JSON.stringify(obj);
    }

    if (typeof obj === 'string') {
      return JSON.stringify(obj);
    }

    if (typeof obj === 'bigint') {
      return JSON.stringify(obj.toString(10));
    }

    if (typeof obj === 'symbol' || typeof obj === 'function') {
      throw new Error(`Erro de canonicalização: Tipo não suportado (${typeof obj}).`);
    }

    if (obj instanceof Date) {
      throw new Error('Erro de canonicalização: Objetos Date não são determinísticos para payloads financeiros.');
    }

    if (Array.isArray(obj)) {
      const items = obj.map((item) => CanonicalRequestHashService.canonicalize(item));
      return `[${items.join(',')}]`;
    }

    if (typeof obj === 'object') {
      const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
      const pairs: string[] = [];

      for (const key of sortedKeys) {
        const val = (obj as Record<string, unknown>)[key];
        if (val !== undefined) {
          const canonicalVal = CanonicalRequestHashService.canonicalize(val);
          pairs.push(`${JSON.stringify(key)}:${canonicalVal}`);
        }
      }

      return `{${pairs.join(',')}}`;
    }

    throw new Error(`Erro de canonicalização: Tipo primitivo não suportado (${typeof obj}).`);
  }

  /**
   * Gera o hash SHA-256 hexadecimal a partir do payload canônico.
   * Se receber um aggregate LedgerTransaction ou DTO com entries, filtra exclusivamente
   * os atributos financeiros determinísticos (removendo IDs aleatórios, UUIDs e timestamps)
   * e ordena os lançamentos deterministicamente por (accountId, assetId, type, amount).
   */
  public static calculateHash(payload: unknown): string {
    let targetPayload = payload;

    if (payload && typeof payload === 'object' && 'entries' in payload && 'idempotencyKey' in payload) {
      const p = payload as any;
      const rawEntries = Array.isArray(p.entries)
        ? p.entries.map((e: any) => ({
            accountId: String(e.accountId),
            amount: String(e.amount?.amount ?? e.amount),
            assetId: String(e.amount?.assetId ?? e.assetId ?? '0'),
            type: String(e.type),
          }))
        : [];

      // Ordenação determinística dos lançamentos por (accountId, assetId, type, amount)
      rawEntries.sort((a: any, b: any) => {
        const keyA = `${a.accountId}:${a.assetId}:${a.type}:${a.amount}`;
        const keyB = `${b.accountId}:${b.assetId}:${b.type}:${b.amount}`;
        return keyA.localeCompare(keyB);
      });

      targetPayload = {
        idempotencyKey: String(p.idempotencyKey),
        userId: p.userId ?? null,
        transactionType: p.transactionType ?? null,
        category: p.category ?? null,
        description: String(p.description),
        refundOfTransactionId: p.refundOfTransactionId ?? null,
        reversalOfTransactionId: p.reversalOfTransactionId ?? null,
        entries: rawEntries,
      };
    }

    const canonicalString = CanonicalRequestHashService.canonicalize(targetPayload);
    return createHash('sha256').update(canonicalString, 'utf8').digest('hex');
  }
}

