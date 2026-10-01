import { IWeb3Repository } from '../../ports/output/IWeb3Repository';
import { ISecureVaultRepository } from '../../ports/output/ISecureVaultRepository';
import { ICryptoVaultPort } from '../../ports/security/ICryptoVaultPort';
import { IBscWalletClientPort } from '../../ports/blockchain/IBscWalletClientPort';
import { EvmAddress } from '../../../domains/web3/value-objects/EvmAddress';
import { OFFICIAL_BSC_TOKENS } from '../../../domains/web3/constants/BscConstants';
import { Result } from '../../../shared/kernel/Result';

export interface SendCustodialTransactionInputDTO {
  userId: number;
  fromAddress: string;
  toAddress: string;
  amount: string;
  assetType: 'BNB' | 'USDT';
}

export interface SendCustodialTransactionOutputDTO {
  txHash: string;
  from: string;
  to: string;
  amount: string;
  asset: string;
  chainId: number;
  explorerUrl: string;
}

/**
 * Caso de Uso: Transferência Custodial Segura na Binance Smart Chain (BSC).
 * 
 * Fluxo de Segurança:
 * 1. Valida estritamente a titularidade da carteira contra o usuário autenticado.
 * 2. Carrega o envelope criptografado do cofre seguro via keyReference.
 * 3. Desencripta em memória com AES-256-GCM + HKDF.
 * 4. Assina e transmite para a rede BSC sem persistir ou logar chaves privadas.
 * 5. Retorna o hash oficial da transação para auditoria pública no BscScan.
 */
export class SendCustodialTransactionUseCase {
  constructor(
    private readonly web3Repo: IWeb3Repository,
    private readonly secureVaultRepo: ISecureVaultRepository,
    private readonly cryptoVault: ICryptoVaultPort,
    private readonly bscWalletClient: IBscWalletClientPort,
    private readonly masterEncryptionKey: string
  ) {}

  async execute(input: SendCustodialTransactionInputDTO): Promise<Result<SendCustodialTransactionOutputDTO>> {
    try {
      // 1. Validação de entradas
      if (!input.userId || !input.fromAddress || !input.toAddress || !input.amount) {
        return Result.fail('Parâmetros obrigatórios ausentes (userId, fromAddress, toAddress, amount).');
      }

      if (!EvmAddress.isValid(input.fromAddress) || !EvmAddress.isValid(input.toAddress)) {
        return Result.fail('Endereço EVM de origem ou destino inválido.');
      }

      const numericAmount = parseFloat(input.amount);
      if (isNaN(numericAmount) || numericAmount <= 0) {
        return Result.fail('O valor da transferência deve ser um número positivo.');
      }

      // 2. Validação da carteira e permissão do usuário
      const wallet = await this.web3Repo.findByAddress(input.fromAddress);
      if (!wallet) {
        return Result.fail('Carteira de origem não encontrada.');
      }

      if (wallet.userId !== input.userId) {
        return Result.fail('Acesso negado: Você não possui autorização sobre esta carteira.');
      }

      if (wallet.status !== 'active' || wallet.verificationStatus !== 'verified') {
        return Result.fail('Carteira de origem indisponível ou suspensa para transações.');
      }

      if (wallet.provenance !== 'internal' || wallet.controlMode !== 'platform_key') {
        return Result.fail('Apenas carteiras custodiais internas podem assinar transações pelo servidor.');
      }

      if (!wallet.keyReference) {
        return Result.fail('Referência de chave de cofre ausente na carteira.');
      }

      // 3. Localização do segredo cifrado no cofre
      const vaultRecord = await this.secureVaultRepo.findByKeyReference(wallet.keyReference);
      if (!vaultRecord) {
        return Result.fail('Cofre criptográfico da carteira não localizado.');
      }

      // 4. Decriptografia em memória do segredo (AES-256-GCM + HKDF)
      let decryptedSecret: string;
      if (typeof this.cryptoVault.decryptEnvelope === 'function' && vaultRecord.nonce && vaultRecord.authTag) {
        decryptedSecret = await this.cryptoVault.decryptEnvelope(
          {
            ciphertext: vaultRecord.ciphertext,
            nonce: vaultRecord.nonce,
            authTag: vaultRecord.authTag,
          },
          this.masterEncryptionKey
        );
      } else {
        decryptedSecret = await this.cryptoVault.decrypt(
          vaultRecord.ciphertext,
          this.masterEncryptionKey
        );
      }


      let privateKey: `0x${string}`;
      try {
        const secretObj = JSON.parse(decryptedSecret);
        privateKey = (secretObj.privateKey || secretObj) as `0x${string}`;
      } catch {
        privateKey = decryptedSecret as `0x${string}`;
      }

      if (!privateKey || !privateKey.startsWith('0x') || privateKey.length !== 66) {
        return Result.fail('Falha ao recuperar chave privada válida do cofre.');
      }

      // 5. Transmissão on-chain via BSC Wallet Client
      let result;
      if (input.assetType === 'BNB') {
        result = await this.bscWalletClient.sendNativeBnb({
          privateKey,
          toAddress: input.toAddress as `0x${string}`,
          amountBnb: input.amount,
        });
      } else if (input.assetType === 'USDT') {
        result = await this.bscWalletClient.sendBep20Token({
          privateKey,
          tokenAddress: OFFICIAL_BSC_TOKENS.USDT.address,
          toAddress: input.toAddress as `0x${string}`,
          amountToken: input.amount,
          decimals: 18,
        });
      } else {
        return Result.fail(`Ativo não suportado: '${input.assetType}'. Suportados: 'BNB' ou 'USDT'.`);
      }

      return Result.ok<SendCustodialTransactionOutputDTO>({
        txHash: result.txHash,
        from: result.from,
        to: result.to,
        amount: result.amountFormatted,
        asset: input.assetType,
        chainId: result.chainId,
        explorerUrl: `https://bscscan.com/tx/${result.txHash}`,
      });
    } catch (error: any) {
      return Result.fail(`Falha ao executar transferência custodial na BSC: ${error.message}`);
    }
  }
}
