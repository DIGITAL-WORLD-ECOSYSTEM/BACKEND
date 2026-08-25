/**
 * Project: Governance System (ASPPIBRA DAO)
 * Role: Central System API & Identity Provider
 * Utility: Standardized API Responses (Strict Type Edition)
 */
import { Context } from 'hono';
import { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Resposta de Sucesso Padronizada
 * @param c Contexto do Hono
 * @param message Mensagem amigável
 * @param data Dados (objetos, arrays, etc)
 * @param status Código HTTP que aceita conteúdo (ex: 200, 201)
 */
export const success = (
  c: Context,
  message: string = 'Operação realizada com sucesso',
  data: unknown = null,
  status: ContentfulStatusCode = 200
) => {
  return c.json(
    {
      success: true,
      message,
      data,
    },
    status
  );
};

/**
 * Resposta de Erro Padronizada
 * @param c Contexto do Hono
 * @param message Mensagem de erro
 * @param errors Detalhes técnicos ou de validação
 * @param status Código HTTP que aceita conteúdo (ex: 400, 401, 404, 500)
 */
export const error = (
  c: Context,
  message: string,
  errors: unknown = null,
  status: ContentfulStatusCode = 400
) => {
  return c.json(
    {
      success: false,
      message,
      errors,
    },
    status
  );
};
