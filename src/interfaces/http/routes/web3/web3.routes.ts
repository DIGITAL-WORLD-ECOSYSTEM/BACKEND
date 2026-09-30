import { Hono } from 'hono';
import { Web3WalletController } from '../../controllers/web3/Web3WalletController';

/**
 * Registra e exporta as rotas (Endpoints) HTTP para o módulo Web3.
 */
export function createWeb3Router(controller: Web3WalletController) {
  const router = new Hono();

  // 1. Rota de Usuário Final: Ideal para app/frontend consumir após KYC
  // Exige que o middleware de sessão/auth JWT esteja rodando antes dela
  router.post('/wallets/create', (c) => controller.createUserWallet(c));

  // 2. Rota Administrativa: Ideal para painéis internos
  // Recomendação: Proteger com middleware de Role (ex: Role = ADMIN)
  router.post('/admin/wallets/batch', (c) => controller.batchCreateWallets(c));

  return router;
}
