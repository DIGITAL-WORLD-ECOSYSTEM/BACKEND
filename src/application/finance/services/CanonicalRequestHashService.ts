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
   */
  public static calculateHash(payload: any): string {
    const canonicalString = CanonicalRequestHashService.canonicalize(payload);
    return createHash('sha256').update(canonicalString, 'utf8').digest('hex');
  }
}
