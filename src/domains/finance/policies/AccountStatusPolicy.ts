import { AccountInactiveError } from '../errors/FinancialError';
import { parsePositiveSafeIntegerId } from '../value-objects/Money256';
import { Result } from '../../../shared/kernel/Result';
import {
  DANGEROUS_TEXT_CHARACTERS_REGEX,
  MAX_RAW_TEXT_CEILING,
} from './FinancialTextPolicy';

/**
 * Catálogo canônico de status de contas financeiras.
 * Preserva integralmente os 6 estados conhecidos na arquitetura.
 */
export const ACCOUNT_STATUSES = Object.freeze([
  'active',
  'inactive',
  'suspended',
  'blocked',
  'closed',
  'pending',
] as const);

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export function isAccountStatus(value: unknown): value is AccountStatus {
  return typeof value === 'string' && ACCOUNT_STATUSES.includes(value as AccountStatus);
}

function normalizeDisplayName(name?: string): string {
  if (name === undefined || name === null) {
    return 'desconhecida';
  }

  if (typeof name !== 'string' || name.length > MAX_RAW_TEXT_CEILING) {
    return 'desconhecida';
  }

  const normalized = name.normalize('NFC').trim();
  if (!normalized || DANGEROUS_TEXT_CHARACTERS_REGEX.test(normalized)) {
    return 'desconhecida';
  }
  return normalized;
}

export class AccountStatusPolicy {
  /**
   * Avalia se uma conta com determinado status é operacionalmente habilitada para transações.
   * Somente contas 'active' podem receber débitos ou créditos.
   */
  public static isOperable(status: string | AccountStatus): boolean {
    return status === 'active';
  }

  /**
   * Validação canônica pública preservada para compatibilidade de API (Fase 2 / Orquestradores).
   * Sanitiza o nome descritivo para evitar log/error injection com caracteres de controle.
   */
  public static validateActive(account: { id: number | string; status: string; name?: string }): void {
    if (!account || typeof account !== 'object') {
      throw new AccountInactiveError('Conta financeira inválida ou não informada.');
    }

    let numericId: number;
    try {
      numericId = parsePositiveSafeIntegerId(account.id, 'accountId');
    } catch {
      throw new AccountInactiveError('Identificador de conta inválido.');
    }

    if (!isAccountStatus(account.status) || account.status !== 'active') {
      const displayName = normalizeDisplayName(account.name);
      const safeStatus = typeof account.status === 'string' ? account.status.replace(/[^\w-]/g, '').slice(0, 32) : 'invalid';
      throw new AccountInactiveError(
        `Conta financeira #${numericId} (${displayName}) está com status "${safeStatus}". Movimentações somente são permitidas em contas ativas.`
      );
    }
  }

  /**
   * Validação canônica estilo Result kernel sem lançar exceção.
   */
  public static validateActiveResult(accountId: string | number, status: string): Result<void> {
    let numericId: number;
    try {
      numericId = parsePositiveSafeIntegerId(accountId, 'accountId');
    } catch {
      return Result.fail('Identificador de conta inválido.');
    }

    if (!isAccountStatus(status)) {
      const safeStatus = typeof status === 'string' ? status.replace(/[^\w-]/g, '').slice(0, 32) : 'invalid';
      return Result.fail(
        `Operação bloqueada por política de domínio: Conta ${numericId} possui status inválido: '${safeStatus}'.`
      );
    }

    if (status !== 'active') {
      const safeStatus = typeof status === 'string' ? status.replace(/[^\w-]/g, '').slice(0, 32) : 'invalid';
      return Result.fail(
        `Operação bloqueada por política de domínio: Conta ${numericId} está com status '${safeStatus}' (esperado: 'active').`
      );
    }

    return Result.ok(undefined);
  }

  public static assertCanDebit(status: string | AccountStatus, accountId: number | string): void {
    const validId = parsePositiveSafeIntegerId(accountId, 'accountId');
    if (!this.isOperable(status)) {
      const safeStatus = typeof status === 'string' ? status.replace(/[^\w-]/g, '').slice(0, 32) : 'invalid';
      throw new AccountInactiveError(
        `Account #${validId} is not active (status: ${safeStatus}) and cannot be debited.`
      );
    }
  }

  public static assertCanCredit(status: string | AccountStatus, accountId: number | string): void {
    const validId = parsePositiveSafeIntegerId(accountId, 'accountId');
    if (!this.isOperable(status)) {
      const safeStatus = typeof status === 'string' ? status.replace(/[^\w-]/g, '').slice(0, 32) : 'invalid';
      throw new AccountInactiveError(
        `Account #${validId} is not active (status: ${safeStatus}) and cannot be credited.`
      );
    }
  }
}
