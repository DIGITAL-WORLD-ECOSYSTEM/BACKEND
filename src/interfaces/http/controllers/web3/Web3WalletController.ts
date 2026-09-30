import { Context } from 'hono';
import { CreateInternalWalletUseCase } from '../../../../application/use-cases/web3/CreateInternalWalletUseCase';

export class Web3WalletController {
  constructor(private readonly createWalletUseCase: CreateInternalWalletUseCase) {}

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
}
