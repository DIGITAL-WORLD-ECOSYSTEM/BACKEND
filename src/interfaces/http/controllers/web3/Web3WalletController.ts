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
      if (isNaN(userId) || userId <= 0) {
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
        return c.json({ success: false, message: result.error }, 400);
      }

      return c.json({ success: true, data: result.getValue() }, 201);
    } catch (err: any) {
      return c.json({ success: false, message: 'Erro interno no servidor.' }, 500);
    }
  }

  /**
   * [Rota Administrativa]
   * Cria dezenas/centenas de carteiras em lote de uma vez só.
   * Reproduz a utilidade do script legado de forma segura e auditada.
   */
  async batchCreateWallets(c: Context) {
    try {
      const user = c.get('user');
      const adminUserId = c.get('userId') ?? user?.userId ?? user?.id;
      const body = await c.req.json().catch(() => ({}));
      const count = Number(body.count) || 1;
      const networkId = Number(body.networkId) || 1;
      
      // ID para alocar a carteira (Pode ser um usuário "Tesouraria" do sistema)
      const rawTargetUserId = body.targetUserId ?? adminUserId; 

      if (!rawTargetUserId) {
        return c.json({ success: false, message: 'targetUserId é obrigatório no lote.' }, 400);
      }

      const targetUserId = Number(rawTargetUserId);
      if (isNaN(targetUserId) || targetUserId <= 0) {
        return c.json({ success: false, message: 'targetUserId inválido.' }, 400);
      }

      if (count < 1 || count > 500) {
        return c.json({ success: false, message: 'Limite de segurança: O lote deve conter entre 1 e 500 carteiras.' }, 400);
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
        });

        if (result.isFailure) {
          errors.push(`Erro na carteira ${i + 1}: ${result.error}`);
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
      return c.json({ success: false, message: 'Erro crítico interno ao processar o lote.' }, 500);
    }
  }
}
