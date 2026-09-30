import { Hono } from 'hono';
import { Bindings, Variables } from '../../../../types/bindings';
import { Web3WalletController } from '../../controllers/web3/Web3WalletController';
import { sessionGuard } from '../../middlewares/session_guard';
import { verifyRole } from '../../middlewares/rbac';
import { DrizzleUnitOfWork } from '../../../../infrastructure/repositories/DrizzleUnitOfWork';
import { ViemWalletGenerator } from '../../../../infrastructure/security/crypto/ViemWalletGenerator';
import { WebCryptoVaultAdapter } from '../../../../infrastructure/security/crypto/WebCryptoVaultAdapter';
import { CreateInternalWalletUseCase } from '../../../../application/use-cases/web3/CreateInternalWalletUseCase';

type AppType = {
  Bindings: Bindings;
  Variables: Variables;
};

/**
 * Registra e exporta as rotas (Endpoints) HTTP para o módulo Web3 injetando um controller customizado.
 */
export function createWeb3Router(controller: Web3WalletController) {
  const router = new Hono<AppType>();

  // 1. Rota de Usuário Final: Requer sessão ativa e autenticada
  router.post('/wallets/create', sessionGuard, (c) => controller.createUserWallet(c));

  // 2. Rota Administrativa: Requer sessão ativa e papel administrativo (Role: ADMIN)
  router.post(
    '/admin/wallets/batch',
    sessionGuard,
    verifyRole(['admin']),
    (c) => controller.batchCreateWallets(c)
  );

  return router;
}

/**
 * Função auxiliar de injeção de dependências sob demanda para o roteador canônico.
 */
function buildWeb3Controller(c: any): Web3WalletController {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const walletGenerator = new ViemWalletGenerator();
  const cryptoVault = new WebCryptoVaultAdapter();
  const masterEncryptionKey = c.env.WALLET_ENCRYPTION_KEY || c.env.TOTP_ENCRYPTION_KEY || c.env.JWT_SECRET;
  const useCase = new CreateInternalWalletUseCase(uow, walletGenerator, cryptoVault, masterEncryptionKey);
  return new Web3WalletController(useCase);
}

/**
 * Roteador canônico do módulo Web3 para montagem na aplicação principal.
 */
export const web3Router = new Hono<AppType>();

web3Router.post('/wallets/create', sessionGuard, async (c) => {
  const controller = buildWeb3Controller(c);
  return controller.createUserWallet(c);
});

web3Router.post(
  '/admin/wallets/batch',
  sessionGuard,
  verifyRole(['admin']),
  async (c) => {
    const controller = buildWeb3Controller(c);
    return controller.batchCreateWallets(c);
  }
);

