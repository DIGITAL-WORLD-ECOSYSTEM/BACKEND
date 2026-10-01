import { Hono } from 'hono';
import { Bindings, Variables } from '../../../../types/bindings';
import { Web3WalletController } from '../../controllers/web3/Web3WalletController';
import { sessionGuard } from '../../middlewares/session_guard';
import { verifyRole } from '../../middlewares/rbac';
import { DrizzleWeb3RepositoryAdapter } from '../../../../infrastructure/repositories/DrizzleWeb3RepositoryAdapter';
import { ViemWalletGenerator } from '../../../../infrastructure/security/crypto/ViemWalletGenerator';
import { WebCryptoVaultAdapter } from '../../../../infrastructure/security/crypto/WebCryptoVaultAdapter';
import { CreateInternalWalletUseCase } from '../../../../application/use-cases/web3/CreateInternalWalletUseCase';
import { GetUserWalletsUseCase } from '../../../../application/use-cases/web3/GetUserWalletsUseCase';
import { GetActiveWalletUseCase } from '../../../../application/use-cases/web3/GetActiveWalletUseCase';
import { GetWalletBalanceUseCase } from '../../../../application/use-cases/web3/GetWalletBalanceUseCase';
import { ViemBscPublicClientAdapter } from '../../../../infrastructure/blockchain/ViemBscPublicClientAdapter';

type AppType = {
  Bindings: Bindings;
  Variables: Variables;
};

/**
 * Registra e exporta as rotas (Endpoints) HTTP para o módulo Web3 injetando um controller customizado.
 */
export function createWeb3Router(controller: Web3WalletController) {
  const router = new Hono<AppType>();

  // 1. Rotas de Usuário Final: Requer sessão ativa e autenticada
  router.post('/wallets/create', sessionGuard, (c) => controller.createUserWallet(c));
  router.get('/wallets', sessionGuard, (c) => controller.getUserWallets(c));
  router.get('/wallets/active', sessionGuard, (c) => controller.getActiveWallet(c));
  router.get('/wallets/:address/balance', sessionGuard, (c) => controller.getWalletBalance(c));

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
  const web3Repo = new DrizzleWeb3RepositoryAdapter(db);
  const walletGenerator = new ViemWalletGenerator();
  const cryptoVault = new WebCryptoVaultAdapter();
  const bscClient = new ViemBscPublicClientAdapter({ rpcUrl: c.env.BSC_RPC_URL });
  
  // Fail-Closed: Não herda segredos de JWT. Exige chave de criptografia de cofre dedicada.
  const masterEncryptionKey = c.env.WALLET_ENCRYPTION_KEY || c.env.TOTP_ENCRYPTION_KEY;
  if (!masterEncryptionKey || masterEncryptionKey.trim().length === 0) {
    throw new Error('Configuração crítica ausente: WALLET_ENCRYPTION_KEY não configurada no ambiente.');
  }

  const createUseCase = new CreateInternalWalletUseCase(web3Repo, walletGenerator, cryptoVault, masterEncryptionKey);
  const getUserWalletsUseCase = new GetUserWalletsUseCase(web3Repo);
  const getActiveWalletUseCase = new GetActiveWalletUseCase(web3Repo);
  const getWalletBalanceUseCase = new GetWalletBalanceUseCase(bscClient);

  return new Web3WalletController(createUseCase, getUserWalletsUseCase, getActiveWalletUseCase, getWalletBalanceUseCase);
}

/**
 * Roteador canônico do módulo Web3 para montagem na aplicação principal.
 */
export const web3Router = new Hono<AppType>();

web3Router.post('/wallets/create', sessionGuard, async (c) => {
  try {
    const controller = buildWeb3Controller(c);
    return await controller.createUserWallet(c);
  } catch (err: any) {
    console.error('🚨 [Web3Router] Falha ao inicializar controller:', err);
    return c.json({ success: false, message: 'Serviço temporariamente indisponível.' }, 500);
  }
});

web3Router.get('/wallets', sessionGuard, async (c) => {
  try {
    const controller = buildWeb3Controller(c);
    return await controller.getUserWallets(c);
  } catch (err: any) {
    console.error('🚨 [Web3Router] Falha ao listar carteiras:', err);
    return c.json({ success: false, message: 'Serviço temporariamente indisponível.' }, 500);
  }
});

web3Router.get('/wallets/active', sessionGuard, async (c) => {
  try {
    const controller = buildWeb3Controller(c);
    return await controller.getActiveWallet(c);
  } catch (err: any) {
    console.error('🚨 [Web3Router] Falha ao buscar carteira ativa:', err);
    return c.json({ success: false, message: 'Serviço temporariamente indisponível.' }, 500);
  }
});

web3Router.get('/wallets/:address/balance', sessionGuard, async (c) => {
  try {
    const controller = buildWeb3Controller(c);
    return await controller.getWalletBalance(c);
  } catch (err: any) {
    console.error('🚨 [Web3Router] Falha ao consultar saldo on-chain:', err);
    return c.json({ success: false, message: 'Serviço temporariamente indisponível.' }, 500);
  }
});

web3Router.post(
  '/admin/wallets/batch',
  sessionGuard,
  verifyRole(['admin']),
  async (c) => {
    try {
      const controller = buildWeb3Controller(c);
      return await controller.batchCreateWallets(c);
    } catch (err: any) {
      console.error('🚨 [Web3Router] Falha ao inicializar controller no lote:', err);
      return c.json({ success: false, message: 'Serviço temporariamente indisponível.' }, 500);
    }
  }
);


