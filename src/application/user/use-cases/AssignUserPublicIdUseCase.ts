import { Result } from '../../../shared/kernel/Result';
import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { PublicId } from '../../../domains/user/value-objects/PublicId';
import { UserId } from '../../../shared/kernel/ids/UserId';

export interface AssignUserPublicIdDTO {
  userId: UserId;
  candidatePublicId?: string;
}

export interface AssignUserPublicIdResult {
  userId: UserId;
  publicId: string;
  assignedAt: Date;
}

export class AssignUserPublicIdUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: AssignUserPublicIdDTO): Promise<Result<AssignUserPublicIdResult, Error>> {
    const { userId, candidatePublicId } = dto;

    return await this.uow.execute(async (factory) => {
      const userRepo = factory.getUserRepository();
      const civilRepo = factory.getCivilIdentityRepository();
      const web3Repo = factory.getWeb3Repository();

      // 1. Validar existência, status ativo e não-exclusão do usuário
      const userRecord = await userRepo.findById(userId);
      if (!userRecord) {
        return Result.err(new Error(`Usuário ${userId as unknown as number} não encontrado.`));
      }

      if (userRecord.deletedAt !== null) {
        return Result.err(new Error(`Não é possível atribuir PublicId a uma conta desativada/excluída (${userId as unknown as number}).`));
      }

      if (userRecord.status !== 'active') {
        return Result.err(
          new Error(`Invariante violada: Atribuição de PublicId exige que a conta esteja no estado "active" (Status atual: "${userRecord.status}").`)
        );
      }

      // 2. Idempotência estrita: se já possui PublicId
      if (userRecord.publicId !== null) {
        if (candidatePublicId && userRecord.publicId.toLowerCase() === candidatePublicId.toLowerCase().trim()) {
          return Result.ok({
            userId,
            publicId: userRecord.publicId,
            assignedAt: userRecord.updatedAt,
          });
        }
        return Result.err(
          new Error(`A conta ${userId as unknown as number} já possui um PublicId atribuído (${userRecord.publicId}) e não permite sobreposição.`)
        );
      }

      // 3. Validação KYC Fail-Closed (Ambos devem estar consistentes e aprovados)
      const rawUserId = userId as unknown as number;
      const citizen = await civilRepo.findCitizenByUserId(rawUserId);
      const latestKyc = await civilRepo.getLatestKycByUserId(rawUserId);

      if (!latestKyc || latestKyc.status !== 'approved') {
        return Result.err(
          new Error(`Invariante violada: O usuário ${rawUserId} não possui processo KYC aprovado (Status KYC: "${latestKyc?.status ?? 'nenhum'}").`)
        );
      }

      if (!citizen || citizen.civilStatus !== 'verified') {
        return Result.err(
          new Error(`Invariante violada: O registro civil do cidadão ${rawUserId} não está verificado (Status Civil: "${citizen?.civilStatus ?? 'inexistente'}").`)
        );
      }

      // 4. Validar Carteira Interna Ativa e Determinística
      const wallets = await web3Repo.findByUserId(rawUserId);
      const activeInternalWallets = wallets.filter(
        (w) => w.provenance === 'internal' && w.status === 'active'
      );

      if (activeInternalWallets.length === 0) {
        return Result.err(
          new Error(`Invariante violada: Nenhuma carteira interna ativa encontrada para o usuário ${rawUserId}.`)
        );
      }

      let selectedWallet = activeInternalWallets.find((w) => w.isPrimary);
      if (!selectedWallet) {
        if (activeInternalWallets.length === 1) {
          selectedWallet = activeInternalWallets[0];
        } else {
          return Result.err(
            new Error(`Invariante violada: Múltiplas carteiras internas ativas encontradas para o usuário ${rawUserId} sem carteira primária definida.`)
          );
        }
      }

      const targetAddress = selectedWallet.address;

      if (candidatePublicId && candidatePublicId.toLowerCase().trim() !== targetAddress.toLowerCase().trim()) {
        return Result.err(
          new Error(`O PublicId candidato (${candidatePublicId}) não coincide com o endereço da carteira interna ativa (${targetAddress}).`)
        );
      }

      // 5. Validar Value Object PublicId (EVM Hex Format)
      const publicIdVoResult = PublicId.create(targetAddress);
      if (publicIdVoResult.isErr()) {
        return Result.err(publicIdVoResult.typedError || new Error('PublicId inválido.'));
      }
      const publicId = publicIdVoResult.getValue();

      // 6. Persistência Atômica
      const updateResult = await userRepo.updatePublicId(userId, publicId.getValue());
      if (updateResult.isErr()) {
        return Result.err(new Error(`Falha ao persistir PublicId: ${updateResult.error}`));
      }

      return Result.ok({
        userId,
        publicId: publicId.getValue(),
        assignedAt: new Date(),
      });
    });
  }
}
