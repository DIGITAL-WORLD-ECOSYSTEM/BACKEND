export interface IPasswordHasher {
  hash(password: string, existingSaltB64?: string): Promise<string>;
  verify(password: string, storedHashText: string): Promise<boolean>;
}
