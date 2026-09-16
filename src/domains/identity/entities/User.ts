// SHIM DE COMPATIBILIDADE RETROATIVA SEMÂNTICA
// A entidade canônica do IAM agora é UserAccount para desambiguação com User (perfil)
import {
  UserAccount,
  UserAccountProps,
  UserAccountStatus,
  UserAccountSubjectType,
} from './UserAccount';

export type UserStatus = UserAccountStatus;
export type SubjectType = UserAccountSubjectType;
export type UserProps = UserAccountProps;

export class User extends UserAccount {}
