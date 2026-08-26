export interface UserRecord {
  id: number;
  publicId: string | null;
  email: string | null;
  emailNormalized: string | null;
  status: string;
  subjectType: string;
  failedLoginAttempts: number;
  lastFailedLoginAt: Date | null;
  authEpoch: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserData {
  email?: string;
  emailNormalized?: string;
  subjectType?: 'citizen' | 'organization' | 'system' | 'service';
  status?: 'active' | 'suspended' | 'pending' | 'locked';
}

export interface IUserRepository {
  findById(id: number): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  create(data: CreateUserData): Promise<UserRecord>;
  updateStatus(id: number, status: 'active' | 'suspended' | 'pending' | 'locked'): Promise<void>;
  incrementAuthEpoch?(userId: number): Promise<number>;
  incrementFailedLoginAttempts(userId: number, maxAttempts: number): Promise<void>;
  resetFailedLoginAttempts(userId: number): Promise<void>;
}
