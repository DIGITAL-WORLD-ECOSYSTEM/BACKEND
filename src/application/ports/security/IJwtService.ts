export interface IJwtService {
  sign(payload: any, secret: string, kid?: string): Promise<string>;
  verify(token: string, secret: string): Promise<any>;
}
