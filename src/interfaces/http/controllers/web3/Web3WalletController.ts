import { Context } from 'hono';
import { CreateInternalWalletUseCase } from '../../../../application/use-cases/web3/CreateInternalWalletUseCase';
import { GetUserWalletsUseCase } from '../../../../application/use-cases/web3/GetUserWalletsUseCase';
import { GetActiveWalletUseCase } from '../../../../application/use-cases/web3/GetActiveWalletUseCase';
import { GetWalletBalanceUseCase } from '../../../../application/use-cases/web3/GetWalletBalanceUseCase';
import { SendCustodialTransactionUseCase } from '../../../../application/use-cases/web3/SendCustodialTransactionUseCase';

export class Web3WalletController {
  constructor(
    private readonly createWalletUseCase: CreateInternalWalletUseCase,
    private readonly getUserWalletsUseCase?: GetUserWalletsUseCase,
    private readonly getActiveWalletUseCase?: GetActiveWalletUseCase,
    private readonly getWalletBalanceUseCase?: GetWalletBalanceUseCase,
    private readonly sendCustodialTransactionUseCase?: SendCustodialTransactionUseCase
  ) {}

  /**
   * [Rota de Usuário]
   * Cria uma única carteira atrelada ao usuário autenticado (Disparado Pós-KYC).
   */
  async createUserWallet(c: Context) {
    try {
      const user = c.get('user');
      const rawUserId = c.get('userId') ?? user?.userId ?? user?.id;

      if (!rawUserId) {
        return c.json({ success: false, message: 'Acesso negado: Usuário não autenticado.' }, 401);
      }

      const userId = Number(rawUserId);
      if (isNaN(userId) || userId <= 0 || !Number.isInteger(userId)) {
        return c.json({ success: false, message: 'Identificador de usuário inválido.' }, 400);
      }

      const body = await c.req.json().catch(() => ({}));

      const result = await this.createWalletUseCase.execute({
        userId,
        networkId: Number(body.networkId) || 1, // Ex: 56 para BSC, 1 para Ethereum
        label: body.label || 'Minha Carteira Principal',
        isPrimary: body.isPrimary ?? true,
      });

      if (result.isFailure) {
        // F-07: Sanitiza o erro para o cliente e loga o detalhe internamente
        console.error('[Web3WalletController] Falha ao criar carteira custodial:', result.error);
        return c.json({ success: false, message: 'Falha ao criar carteira interna. Verifique os parâmetros ou contate o suporte.' }, 400);
      }

      return c.json({ success: true, data: result.getValue() }, 201);
    } catch (err: any) {
      console.error('[Web3WalletController] Erro inesperado:', err);
      return c.json({ success: false, message: 'Erro interno no servidor.' }, 500);
    }
  }

  /**
   * [Rota Administrativa]
   * Cria carteiras em lote de forma segura e transacional.
   * Reproduz a utilidade do script legado com limites estritos anti-DoS.
   */
  async batchCreateWallets(c: Context) {
    try {
      const user = c.get('user');
      const adminUserId = c.get('userId') ?? user?.userId ?? user?.id;
      const body = await c.req.json().catch(() => ({}));
      const rawCount = body.count ?? 1;
      const count = Number(rawCount);
      const networkId = Number(body.networkId) || 1;
      
      // ID para alocar a carteira (Pode ser um usuário "Tesouraria" do sistema)
      const rawTargetUserId = body.targetUserId ?? adminUserId; 

      if (!rawTargetUserId) {
        return c.json({ success: false, message: 'targetUserId é obrigatório no lote.' }, 400);
      }

      const targetUserId = Number(rawTargetUserId);
      if (isNaN(targetUserId) || targetUserId <= 0 || !Number.isInteger(targetUserId)) {
        return c.json({ success: false, message: 'targetUserId inválido.' }, 400);
      }

      // F-06: Limite de segurança de até 50 carteiras por chamada síncrona para não exceder quota de CPU
      if (!Number.isInteger(count) || count < 1 || count > 50) {
        return c.json({ success: false, message: 'Limite de segurança: O lote deve conter um número inteiro entre 1 e 50 carteiras.' }, 400);
      }

      const createdWallets = [];
      const errors = [];

      // Loop para gerar carteiras
      for (let i = 0; i < count; i++) {
        const result = await this.createWalletUseCase.execute({
          userId: targetUserId,
          networkId: networkId,
          label: `Batch Wallet #${i + 1} - ${new Date().toISOString()}`,
          isPrimary: false,
          status: 'pending', // Carteiras de lote nascem como 'pending' para alocação/ativação posterior
        });

        if (result.isFailure) {
          console.error(`[Web3WalletController] Erro na carteira ${i + 1}:`, result.error);
          errors.push(`Erro na carteira ${i + 1}: Falha ao processar.`);
        } else {
          createdWallets.push(result.getValue());
        }
      }

      return c.json({
        success: true,
        message: `${createdWallets.length} carteiras criadas com sucesso.`,
        data: createdWallets,
        errors: errors.length > 0 ? errors : undefined,
      }, 201);
    } catch (err: any) {
      console.error('[Web3WalletController] Erro crítico no lote:', err);
      return c.json({ success: false, message: 'Erro crítico interno ao processar o lote.' }, 500);
    }
  }

  /**
   * [Rota de Usuário]
   * Lista todas as carteiras associadas ao usuário autenticado.
   */
  async getUserWallets(c: Context) {
    try {
      const user = c.get('user');
      const rawUserId = c.get('userId') ?? user?.userId ?? user?.id;

      if (!rawUserId) {
        return c.json({ success: false, message: 'Acesso negado: Usuário não autenticado.' }, 401);
      }

      const userId = Number(rawUserId);
      if (isNaN(userId) || userId <= 0 || !Number.isInteger(userId)) {
        return c.json({ success: false, message: 'Identificador de usuário inválido.' }, 400);
      }

      if (!this.getUserWalletsUseCase) {
        return c.json({ success: false, message: 'Funcionalidade não configurada no servidor.' }, 501);
      }

      const result = await this.getUserWalletsUseCase.execute({ userId });
      if (result.isFailure) {
        return c.json({ success: false, message: result.error }, 400);
      }

      return c.json({ success: true, data: result.getValue() }, 200);
    } catch (err: any) {
      console.error('[Web3WalletController] Erro ao listar carteiras:', err);
      return c.json({ success: false, message: 'Erro interno no servidor.' }, 500);
    }
  }

  /**
   * [Rota de Usuário]
   * Retorna a carteira ativa/principal do usuário autenticado.
   */
  async getActiveWallet(c: Context) {
    try {
      const user = c.get('user');
      const rawUserId = c.get('userId') ?? user?.userId ?? user?.id;

      if (!rawUserId) {
        return c.json({ success: false, message: 'Acesso negado: Usuário não autenticado.' }, 401);
      }

      const userId = Number(rawUserId);
      if (isNaN(userId) || userId <= 0 || !Number.isInteger(userId)) {
        return c.json({ success: false, message: 'Identificador de usuário inválido.' }, 400);
      }

      if (!this.getActiveWalletUseCase) {
        return c.json({ success: false, message: 'Funcionalidade não configurada no servidor.' }, 501);
      }

      const result = await this.getActiveWalletUseCase.execute({ userId });
      if (result.isFailure) {
        return c.json({ success: false, message: result.error }, 400);
      }

      const data = result.getValue();
      if (!data) {
        return c.json({ success: false, message: 'Nenhuma carteira ativa encontrada para este usuário.' }, 404);
      }

      return c.json({ success: true, data }, 200);
    } catch (err: any) {
      console.error('[Web3WalletController] Erro ao buscar carteira ativa:', err);
      return c.json({ success: false, message: 'Erro interno no servidor.' }, 500);
    }
  }

  /**
   * [Rota de Usuário]
   * Consulta o saldo on-chain da carteira em BNB e tokens BEP-20 (USDT).
   */
  async getWalletBalance(c: Context) {
    try {
      const user = c.get('user');
      const rawUserId = c.get('userId') ?? user?.userId ?? user?.id;

      if (!rawUserId) {
        return c.json({ success: false, message: 'Acesso negado: Usuário não autenticado.' }, 401);
      }

      const address = c.req.param('address');
      if (!address) {
        return c.json({ success: false, message: 'Parâmetro address é obrigatório.' }, 400);
      }

      if (!this.getWalletBalanceUseCase) {
        return c.json({ success: false, message: 'Funcionalidade de saldo não configurada no servidor.' }, 501);
      }

      const result = await this.getWalletBalanceUseCase.execute({ address });
      if (result.isFailure) {
        return c.json({ success: false, message: result.error }, 400);
      }

      return c.json({ success: true, data: result.getValue() }, 200);
    } catch (err: any) {
      console.error('[Web3WalletController] Erro ao consultar saldo on-chain:', err);
      return c.json({ success: false, message: 'Erro interno no servidor.' }, 500);
    }
  }

  /**
   * [Rota de Usuário]
   * Executa a transferência de fundos (BNB ou USDT) assinada pelo cofre custodial na BSC.
   */
  async sendTransaction(c: Context) {
    try {
      const user = c.get('user');
      const rawUserId = c.get('userId') ?? user?.userId ?? user?.id;

      if (!rawUserId) {
        return c.json({ success: false, message: 'Acesso negado: Usuário não autenticado.' }, 401);
      }

      const userId = Number(rawUserId);
      if (isNaN(userId) || userId <= 0 || !Number.isInteger(userId)) {
        return c.json({ success: false, message: 'Identificador de usuário inválido.' }, 400);
      }

      const body = await c.req.json().catch(() => ({}));

      if (!body.fromAddress || !body.toAddress || !body.amount) {
        return c.json({
          success: false,
          message: 'fromAddress, toAddress e amount são campos obrigatórios.',
        }, 400);
      }

      if (!this.sendCustodialTransactionUseCase) {
        return c.json({ success: false, message: 'Funcionalidade de transferência não configurada no servidor.' }, 501);
      }

      const result = await this.sendCustodialTransactionUseCase.execute({
        userId,
        fromAddress: body.fromAddress,
        toAddress: body.toAddress,
        amount: String(body.amount),
        assetType: (body.assetType?.toUpperCase() === 'USDT' ? 'USDT' : 'BNB') as 'BNB' | 'USDT',
      });

      if (result.isFailure) {
        console.error('[Web3WalletController] Falha na transferência custodial:', result.error);
        return c.json({ success: false, message: result.error }, 400);
      }

      return c.json({
        success: true,
        message: 'Transação transmitida com sucesso para a rede Binance Smart Chain.',
        data: result.getValue(),
      }, 200);
    } catch (err: any) {
      console.error('[Web3WalletController] Erro crítico na transferência custodial:', err);
      return c.json({ success: false, message: 'Erro interno no servidor.' }, 500);
    }
  }
}
