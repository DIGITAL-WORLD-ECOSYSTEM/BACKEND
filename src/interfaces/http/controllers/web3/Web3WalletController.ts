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
      const user = c.get('user'); // Usuário extraído do JWT ou Sessão ativa
      const body = await c.req.json().catch(() => ({}));

      if (!user || !user.id) {
        return c.json({ success: false, message: 'Acesso negado: Usuário não autenticado.' }, 401);
      }

      const result = await this.createWalletUseCase.execute({
        userId: user.id,
        networkId: body.networkId || 1, // Ex: 56 para BSC, 1 para Ethereum
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
   * Reproduz a exata utilidade do seu antigo script app.py de Python, mas protegido na nuvem.
   */
  async batchCreateWallets(c: Context) {
    try {
      const body = await c.req.json().catch(() => ({}));
      const count = body.count || 1;
      const networkId = body.networkId || 1;
      
      // Um ID para alocar as carteiras (Pode ser um usuário "Tesouraria" do sistema)
      const targetUserId = body.targetUserId; 

      if (!targetUserId) {
        return c.json({ success: false, message: 'targetUserId é obrigatório no lote.' }, 400);
      }
      if (count > 500) {
        return c.json({ success: false, message: 'Limite de segurança: Máximo de 500 carteiras por lote.' }, 400);
      }

      const createdWallets = [];
      const errors = [];

      // Loop nativo para gerar carteiras (Substituindo o laço "for _ in range(count)" do Python)
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
