export interface UserRecord {
  id: number;
  publicId: string | null;
  email: string;
  emailNormalized: string | null;
  status: string;
  subjectType: string;
  authEpoch?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserData {
  email: string;
  emailNormalized?: string;
  subjectType?: 'citizen' | 'organization' | 'system';
  status?: 'active' | 'suspended' | 'pending';
}

export interface IUserRepository {
  findById(id: number): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  create(data: CreateUserData): Promise<UserRecord>;
  updateStatus(id: number, status: 'active' | 'suspended' | 'pending'): Promise<void>;
  incrementAuthEpoch?(userId: number): Promise<number>;
}

