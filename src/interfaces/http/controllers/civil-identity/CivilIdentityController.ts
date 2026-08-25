import { Context } from 'hono';
import { RegisterCitizenUseCase } from '../../../../domains/civil-identity/use-cases/RegisterCitizenUseCase';
import { SubmitKycVerificationUseCase } from '../../../../domains/civil-identity/use-cases/SubmitKycVerificationUseCase';
import { ICivilIdentityRepository } from '../../../../application/ports/output/ICivilIdentityRepository';

export class CivilIdentityController {
  constructor(
    private readonly registerCitizenUseCase: RegisterCitizenUseCase,
    private readonly submitKycUseCase: SubmitKycVerificationUseCase,
    private readonly civilRepo: ICivilIdentityRepository
  ) {}

  async register(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId') || c.get('user')?.userId;
      if (!userId) {
        return c.json({ success: false, message: 'Usuário não autenticado' }, 401);
      }

      const body = await c.req.json();
      const result = await this.registerCitizenUseCase.execute({
        userId,
        legalFirstName: body.legalFirstName,
        legalLastName: body.legalLastName,
        nationalityCode: body.nationalityCode,
        birthDate: body.birthDate,
        maritalStatus: body.maritalStatus,
      });

      if (result.isFailure) {
        return c.json({ success: false, message: result.error || 'Erro ao registrar cidadão' }, 400);
      }

      return c.json({ success: true, message: 'Dados civis registrados com sucesso', data: result.getValue() }, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
    }
  }

  async submitKyc(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId') || c.get('user')?.userId;
      if (!userId) {
        return c.json({ success: false, message: 'Usuário não autenticado' }, 401);
      }

      const body = await c.req.json();
      const result = await this.submitKycUseCase.execute({
        userId,
        verificationLevel: body.verificationLevel || 'basic',
        documentType: body.documentType || 'cpf',
        documentNumber: body.documentNumber,
        provider: body.provider,
      });

      if (result.isFailure) {
        return c.json({ success: false, message: result.error || 'Erro no processo de KYC' }, 400);
      }

      return c.json({ success: true, message: 'Solicitação KYC enviada com sucesso', data: result.getValue() }, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
    }
  }

  async getMe(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId') || c.get('user')?.userId;
      if (!userId) {
        return c.json({ success: false, message: 'Usuário não autenticado' }, 401);
      }

      const citizen = await this.civilRepo.findCitizenByUserId(userId);
      const docs = await this.civilRepo.findDocumentsByUserId(userId);
      const kyc = await this.civilRepo.getLatestKycByUserId(userId);

      return c.json({
        success: true,
        data: {
          citizen,
          documentsCount: docs.length,
          latestKyc: kyc,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
    }
  }
}
