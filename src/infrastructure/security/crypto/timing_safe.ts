/**
 * Utilitário: Timing-Safe String Comparison
 * Previne ataques de timing (side-channel) ao comparar strings secretas.
 * Usa Web Crypto API (disponível em Cloudflare Workers).
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);

  // Arrays devem ter o mesmo comprimento para a comparação ser segura.
  // Paddinamos o array menor com zeros — a comparação final ainda retorna false.
  const len = Math.max(aBytes.length, bBytes.length);
  const aPadded = new Uint8Array(len);
  const bPadded = new Uint8Array(len);
  aPadded.set(aBytes);
  bPadded.set(bBytes);

  // XOR byte a byte — resultado != 0 significa strings diferentes
  let diff = 0;
  for (let i = 0; i < len; i++) {
    diff |= aPadded[i] ^ bPadded[i];
  }

  // Também garante que os comprimentos originais são iguais
  diff |= aBytes.length ^ bBytes.length;

  return diff === 0;
}
