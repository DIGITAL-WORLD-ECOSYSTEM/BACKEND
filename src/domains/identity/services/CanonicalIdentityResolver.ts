import { IIdentityResolverPort } from '../../../application/ports/output/IIdentityResolverPort';
import { IdentityAssertion } from '../../../application/dto/identity/IdentityAssertion';
import { IdentityResolutionResult } from '../../../application/dto/identity/IdentityResolutionResult';

export class CanonicalIdentityResolver implements IIdentityResolverPort {
  constructor(private readonly resolverAdapter: IIdentityResolverPort) { }

  async resolve(assertion: IdentityAssertion): Promise<IdentityResolutionResult> {
    return this.resolverAdapter.resolve(assertion);
  }
}
