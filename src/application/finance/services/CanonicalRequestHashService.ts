import { createHash } from 'crypto';

export type CanonicalPrimitive = string | number | boolean | null;
export type CanonicalValue =
  | CanonicalPrimitive
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

export interface CanonicalEntryInput {
  accountId: string | number;
  amount: { amount: bigint | string | number; assetId: number | string } | bigint | string | number;
  assetId?: number | string;
  type: 'debit' | 'credit' | string;
}

export interface CanonicalTransactionInput {
  userId?: number | null;
  transactionType?: string | null;
  category?: string | null;
  description?: string | null;
  refundOfTransactionId?: number | null;
  reversalOfTransactionId?: number | null;
  entries: ReadonlyArray<CanonicalEntryInput>;
}

export class CanonicalRequestHashService {
  /**
   * Converte recursivamente um objeto/payload para formato JSON canônico:
   * 1. Ordena chaves de objetos alfabeticamente com ordenação binária pura.
   * 2. Rejeita `undefined`, arrays esparsos e objetos não-planos (Map, Set, etc).
   * 3. Rejeita tipos não determinísticos (Date, Function, Symbol).
   * 4. Valida inteiros seguros em números (Number.isSafeInteger) ou BigInt.
   * 5. Garante representação determinística sem dependência de locale.
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
      if (!Number.isSafeInteger(obj)) {
        throw new Error(`Erro de canonicalização: Número fora do limite de precisão inteira segura (${obj}). Utilize BigInt ou decimal string.`);
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
      // Rejeição estrita de arrays esparsos (sparse arrays)
      for (let i = 0; i < obj.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(obj, i)) {
          throw new Error('Erro de canonicalização: Arrays esparsos (sparse arrays com lacunas) são estritamente proibidos.');
        }
      }
      const items = obj.map((item) => CanonicalRequestHashService.canonicalize(item));
      return `[${items.join(',')}]`;
    }

    if (typeof obj === 'object') {
      // Rejeição de objetos customizados / não-planos (Map, Set, etc.)
      const proto = Object.getPrototypeOf(obj);
      if (proto !== null && proto !== Object.prototype) {
        throw new Error(`Erro de canonicalização: Instância de objeto não-plano (${obj.constructor?.name ?? 'custom'}) é proibida.`);
      }

      const record = obj as Record<string, unknown>;
      // Ordenação binária/lexicográfica pura (sem localeCompare)
      const sortedKeys = Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const pairs: string[] = [];

      for (const key of sortedKeys) {
        const val = record[key];
        if (val === undefined) {
          throw new Error(`Erro de canonicalização: undefined não é permitido na chave "${key}".`);
        }
        const canonicalVal = CanonicalRequestHashService.canonicalize(val);
        pairs.push(`${JSON.stringify(key)}:${canonicalVal}`);
      }

      return `{${pairs.join(',')}}`;
    }

    throw new Error(`Erro de canonicalização: Tipo primitivo não suportado (${typeof obj}).`);
  }

  /**
   * Extrai e formata o fingerprint financeiro canônico estritamente tipado.
   */
  private static isCanonicalTransactionInput(payload: unknown): payload is CanonicalTransactionInput {
    return (
      payload !== null &&
      typeof payload === 'object' &&
      'entries' in payload &&
      Array.isArray((payload as any).entries)
    );
  }

  /**
   * Gera o hash SHA-256 hexadecimal a partir do payload canônico do negócio.
   * Se receber um aggregate LedgerTransaction ou DTO com entries, filtra exclusivamente
   * os atributos financeiros determinísticos (removendo IDs aleatórios, UUIDs e timestamps)
   * e ordena os lançamentos por ordenação estrutural por tupla (accountId, assetId, type, amount).
   */
  public static calculateHash(payload: unknown): string {
    let targetPayload = payload;

    if (CanonicalRequestHashService.isCanonicalTransactionInput(payload)) {
      const p = payload;
      const rawEntries = p.entries.map((e) => {
        const amountObj = typeof e.amount === 'object' && e.amount !== null ? e.amount : null;
        const amountVal = amountObj ? String(amountObj.amount) : String(e.amount);
        const assetVal = amountObj ? String(amountObj.assetId) : String(e.assetId ?? '0');

        return {
          accountId: String(e.accountId),
          amount: amountVal,
          assetId: assetVal,
          type: String(e.type),
        };
      });

      // Ordenação determinística estrita por tupla (accountId -> assetId -> type -> amount)
      rawEntries.sort((a, b) => {
        if (a.accountId !== b.accountId) return a.accountId < b.accountId ? -1 : 1;
        if (a.assetId !== b.assetId) return a.assetId < b.assetId ? -1 : 1;
        if (a.type !== b.type) return a.type < b.type ? -1 : 1;
        if (a.amount !== b.amount) return a.amount < b.amount ? -1 : 1;
        return 0;
      });

      targetPayload = {
        userId: p.userId ?? null,
        transactionType: p.transactionType ?? null,
        category: p.category ?? null,
        description: p.description !== undefined ? String(p.description) : undefined,
        refundOfTransactionId: p.refundOfTransactionId ?? null,
        reversalOfTransactionId: p.reversalOfTransactionId ?? null,
        entries: rawEntries,
      };
    }

    const canonicalString = CanonicalRequestHashService.canonicalize(targetPayload);
    return createHash('sha256').update(canonicalString, 'utf8').digest('hex');
  }
}



