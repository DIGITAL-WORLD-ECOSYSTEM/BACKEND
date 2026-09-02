import { createHash } from 'crypto';

export class CanonicalRequestHashService {
  /**
   * Converte recursivamente um objeto/payload para formato JSON canônico:
   * 1. Ordena chaves de objetos alfabeticamente.
   * 2. Remove valores `undefined`.
   * 3. Converte números para representação de string padrão.
   * 4. Remove qualquer espaço de formatação.
   */
  public static canonicalize(obj: any): string {
    if (obj === null || typeof obj !== 'object') {
      if (typeof obj === 'bigint') {
        return obj.toString(10);
      }
      return JSON.stringify(obj);
    }

    if (Array.isArray(obj)) {
      const items = obj.map((item) => CanonicalRequestHashService.canonicalize(item));
      return `[${items.join(',')}]`;
    }

    const sortedKeys = Object.keys(obj).sort();
    const pairs: string[] = [];

    for (const key of sortedKeys) {
      const val = obj[key];
      if (val !== undefined) {
        const canonicalVal = CanonicalRequestHashService.canonicalize(val);
        pairs.push(`${JSON.stringify(key)}:${canonicalVal}`);
      }
    }

    return `{${pairs.join(',')}}`;
  }

  /**
   * Gera o hash SHA-256 hexadecimal a partir do payload canônico.
   * Se receber um aggregate LedgerTransaction ou DTO com entries, filtra exclusivamente
   * os atributos financeiros determinísticos (removendo IDs aleatórios, UUIDs e timestamps).
   */
  public static calculateHash(payload: any): string {
    let targetPayload = payload;

    if (payload && typeof payload === 'object' && 'entries' in payload && 'idempotencyKey' in payload) {
      targetPayload = {
        idempotencyKey: payload.idempotencyKey,
        userId: payload.userId ?? null,
        transactionType: payload.transactionType ?? null,
        category: payload.category ?? null,
        description: payload.description,
        refundOfTransactionId: payload.refundOfTransactionId ?? null,
        reversalOfTransactionId: payload.reversalOfTransactionId ?? null,
        entries: Array.isArray(payload.entries)
          ? payload.entries.map((e: any) => ({
              accountId: String(e.accountId),
              amount: String(e.amount?.amount ?? e.amount),
              assetId: Number(e.amount?.assetId ?? e.assetId ?? 0),
              type: e.type,
            }))
          : [],
      };
    }

    const canonicalString = CanonicalRequestHashService.canonicalize(targetPayload);
    return createHash('sha256').update(canonicalString, 'utf8').digest('hex');
  }
}
