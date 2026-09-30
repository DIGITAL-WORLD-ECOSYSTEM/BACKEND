import { IWalletGeneratorPort } from '../../../application/ports/security/IWalletGeneratorPort';
import { ICryptoVaultPort } from '../../../application/ports/security/ICryptoVaultPort';
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';

export interface CreateInternalWalletInputDTO {
  userId: number;
  networkId: number;
  label?: string;
  isPrimary?: boolean;
}

export interface CreateInternalWalletOutputDTO {
  walletId: number;
  address: string;
}

/**
 * Caso de Uso: Criação de Carteira Interna (Custodial).
 * 
 * Substitui o antigo app.py de Python para garantir a segurança em camadas,
 * a não exposição de chaves privadas em logs e o uso de criptografia forte.
 */
export class CreateInternalWalletUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly walletGenerator: IWalletGeneratorPort,
    private readonly cryptoVault: ICryptoVaultPort,
    private readonly masterEncryptionKey: string // Injetado via env
  ) {}

  async execute(input: CreateInternalWalletInputDTO): Promise<Result<CreateInternalWalletOutputDTO>> {
    try {
      if (!input.userId || !input.networkId) {
        return Result.fail('ID do usuário e ID da rede são obrigatórios.');
      }

      // 1. O Motor Matemático (Viem): Gera a chave com segurança em memória
      const generatedWallet = await this.walletGenerator.generateWallet();

      // 2. Transação Atômica: Nenhuma gravação acontece se houver falha no meio
      return await this.uow.execute(async (factory) => {
        // Pegamos os adaptadores de banco de dados do nosso UnitOfWork
        const web3Repo = factory.getWeb3Repository();
        
        // (Nota Arquitetural: Se getSecureVaultRepository não existir, vamos criá-lo no próximo passo)
        const secureVaultRepo = factory.getSecureVaultRepository(); 

        // 3. O Cofre Seguro (AES-256): Criptografa a chave privada
        // NUNCA DEIXE ESTA CHAVE PLANA.
        const encryptedPayload = await this.cryptoVault.encrypt(
          generatedWallet.privateKey, 
          this.masterEncryptionKey
        );

        // 4. Salvar na Tabela secure_vaults (Onde ficam os segredos)
        const vaultId = await secureVaultRepo.createVault({
          userId: input.userId,
          purpose: 'private_key',
          ciphertext: encryptedPayload, // Ciphertext base64 contendo auth_tag e nonce embutidos
        });

        // 5. Salvar na Tabela wallets (O Estado Público / Blockchain)
        const newWallet = await web3Repo.createInternalWallet({
          userId: input.userId,
          networkId: input.networkId,
          provenance: 'internal',
          walletType: 'eoa', // Externally Owned Account normal (não contrato inteligente)
          controlMode: 'platform_key',
          address: generatedWallet.address,
          addressNormalized: generatedWallet.address.toLowerCase(),
          label: input.label || 'Default Internal Wallet',
          isPrimary: input.isPrimary ?? false,
          
          // O Vínculo de Segurança Crucial:
          keyProvider: 'secure_vault',
          keyReference: vaultId.toString(),
          
          status: 'active',
          verificationStatus: 'verified', // Custodial é verificada por padrão
        });

        return Result.ok<CreateInternalWalletOutputDTO>({
          walletId: newWallet.id,
          address: newWallet.address,
        });
      });
    } catch (error: any) {
      return Result.fail<CreateInternalWalletOutputDTO>(
        `Falha arquitetural ao criar carteira interna: ${error.message}`
      );
    }
  }
}
