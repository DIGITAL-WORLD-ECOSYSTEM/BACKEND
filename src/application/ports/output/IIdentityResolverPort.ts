import { IdentityAssertion } from '../../dto/IdentityAssertion';
import { IdentityResolutionResult } from '../../dto/IdentityResolutionResult';

/**
 * Porta de saída para Resolução Canônica de Identidade.
 * O orquestrador central (CanonicalIdentityResolver) implementa esta interface
 * para isolar os Use Cases de infraestrutura e persistência concreta.
 */
export interface IIdentityResolverPort {
  resolve(assertion: IdentityAssertion): Promise<IdentityResolutionResult>;
}
