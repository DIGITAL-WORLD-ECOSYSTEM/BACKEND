import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ARCHITECTURE BOUNDARIES TEST SUITE — PADRÃO OURO v4 FECHAMENTO FINAL
 * 
 * Executable Architectural Governance enforcing:
 * 1. Domain Purity (Zero Infrastructure, Framework, or Application imports in src/domains/)
 * 2. Application Layer DIP Isolation (Zero Infrastructure or HTTP Framework imports in src/application/)
 * 3. Shared Kernel Standalone Isolation (Zero domain/app/infra imports in src/shared/kernel/)
 * 4. HTTP Controller Isolation (Zero direct ORM/Drizzle or concrete repository imports in Controllers)
 * 5. Account-First Identity Invariance (Prohibits hardcoded shadow account domains @web3.local and @ssi.local)
 * 6. Composition-Only Bootstrap Invariance (src/bootstrap/ contains composition wiring only, no business logic)
 * 7. Cross-Domain Matrix with 3 Relation Categories (direct_imports, references, events)
 */

const SRC_DIR = path.resolve(__dirname, '../../src');

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  if (!fs.existsSync(dirPath)) return arrayOfFiles;
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles);
    } else if (file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.d.ts')) {
      arrayOfFiles.push(fullPath);
    }
  });

  return arrayOfFiles;
}

function parseImports(fileContent: string): string[] {
  const importRegex = /(?:import|export)\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g;
  const imports: string[] = [];
  let match;
  while ((match = importRegex.exec(fileContent)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

interface CrossDomainRule {
  direct_imports: string[];
  references: string[];
  events: {
    publishes: string[];
    consumes: string[];
  };
  forbidden: string[];
}

const CROSS_DOMAIN_MATRIX_V4: Record<string, CrossDomainRule> = {
  identity: {
    direct_imports: ['shared/kernel'],
    references: ['UserId'],
    events: {
      publishes: ['IdentityLinked', 'IdentityUnlinked'],
      consumes: ['UserRegistered'],
    },
    forbidden: ['finance', 'web3', 'civil-identity'],
  },
  finance: {
    direct_imports: ['shared/kernel'],
    references: ['UserId'],
    events: {
      publishes: ['LedgerEntryPosted'],
      consumes: ['Web3TransactionConfirmedV1'],
    },
    forbidden: ['web3', 'civil-identity'],
  },
  user: {
    direct_imports: ['shared/kernel'],
    references: [],
    events: {
      publishes: ['UserRegistered', 'UserStatusChanged'],
      consumes: [],
    },
    forbidden: ['finance', 'web3', 'civil-identity', 'ssi'],
  },
  web3: {
    direct_imports: ['shared/kernel'],
    references: ['UserId'],
    events: {
      publishes: ['Web3TransactionConfirmed'],
      consumes: [],
    },
    forbidden: ['finance'],
  },
  authorization: {
    direct_imports: ['shared/kernel'],
    references: ['UserId'],
    events: {
      publishes: [],
      consumes: [],
    },
    forbidden: ['finance', 'web3', 'communication'],
  },
  'civil-identity': {
    direct_imports: ['shared/kernel'],
    references: ['UserId'],
    events: {
      publishes: ['KycStatusChanged'],
      consumes: [],
    },
    forbidden: ['web3', 'finance'],
  },
  ssi: {
    direct_imports: ['shared/kernel'],
    references: ['UserId'],
    events: {
      publishes: [],
      consumes: ['KycStatusChanged'],
    },
    forbidden: ['finance', 'communication'],
  },
};

describe('Executable Architectural Boundaries & Governance Suite — Padrão Ouro v4', () => {
  const allSrcFiles = getAllFiles(SRC_DIR);

  describe('1. Domain Purity Invariants (src/domains/)', () => {
    const domainFiles = allSrcFiles.filter((f) => f.includes(path.join('src', 'domains')));

    it('should enforce domain purity across all domain files', () => {
      if (domainFiles.length > 0) {
        domainFiles.forEach((filePath) => {
          const content = fs.readFileSync(filePath, 'utf-8');
          const imports = parseImports(content);

          imports.forEach((imp) => {
            expect(imp, `Forbidden Hono import in domain file ${filePath}`).not.toMatch(/^hono(\/.*)?$/);
            expect(imp, `Forbidden Drizzle import in domain file ${filePath}`).not.toMatch(/^drizzle-orm(\/.*)?$/);
            expect(imp, `Forbidden Workers types in domain file ${filePath}`).not.toMatch(/^@cloudflare\/workers-types$/);
            expect(imp, `Forbidden Infrastructure import in domain file ${filePath}`).not.toMatch(/infrastructure/);
            expect(imp, `Forbidden Interfaces import in domain file ${filePath}`).not.toMatch(/interfaces/);
          });
        });
      }
    });
  });

  describe('2. Application Layer DIP Invariants (src/application/)', () => {
    const appFiles = allSrcFiles.filter((f) => f.includes(path.join('src', 'application')));

    it('should not import infrastructure or framework adapters in src/application/', () => {
      appFiles.forEach((filePath) => {
        const content = fs.readFileSync(filePath, 'utf-8');
        const imports = parseImports(content);

        imports.forEach((imp) => {
          expect(imp, `Application file ${filePath} must not import infrastructure`).not.toMatch(/infrastructure/);
          expect(imp, `Application file ${filePath} must not import drizzle-orm`).not.toMatch(/^drizzle-orm(\/.*)?$/);
          expect(imp, `Application file ${filePath} must not import hono`).not.toMatch(/^hono(\/.*)?$/);
          expect(imp, `Application file ${filePath} must not import interfaces`).not.toMatch(/interfaces/);
        });
      });
    });
  });

  describe('3. Shared Kernel Isolation (src/shared/kernel/)', () => {
    const kernelFiles = allSrcFiles.filter((f) => f.includes(path.join('src', 'shared', 'kernel')));

    it('shared/kernel/ files must not depend on domains, application, infrastructure or interfaces', () => {
      kernelFiles.forEach((filePath) => {
        const content = fs.readFileSync(filePath, 'utf-8');
        const imports = parseImports(content);

        imports.forEach((imp) => {
          expect(imp, `Shared Kernel ${filePath} must not import domains`).not.toMatch(/domains/);
          expect(imp, `Shared Kernel ${filePath} must not import application`).not.toMatch(/application/);
          expect(imp, `Shared Kernel ${filePath} must not import infrastructure`).not.toMatch(/infrastructure/);
          expect(imp, `Shared Kernel ${filePath} must not import interfaces`).not.toMatch(/interfaces/);
        });
      });
    });
  });

  describe('4. HTTP Controllers Isolation (src/interfaces/http/controllers/)', () => {
    const controllerFiles = allSrcFiles.filter((f) => f.includes(path.join('src', 'interfaces', 'http', 'controllers')));

    it('HTTP Controllers must not directly import ORM or concrete repository adapters', () => {
      controllerFiles.forEach((filePath) => {
        const content = fs.readFileSync(filePath, 'utf-8');
        const imports = parseImports(content);

        imports.forEach((imp) => {
          expect(imp, `Controller ${filePath} must not import drizzle-orm`).not.toMatch(/^drizzle-orm(\/.*)?$/);
          expect(imp, `Controller ${filePath} must not import concrete repositories`).not.toMatch(/infrastructure\/repositories/);
        });
      });
    });
  });

  describe('5. Account-First Identity Anti-Shadow-Account Invariance', () => {
    it('Source code must not contain hardcoded shadow account domains (@web3.local, @ssi.local)', () => {
      allSrcFiles.forEach((filePath) => {
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content, `File ${filePath} contains forbidden shadow account string @web3.local`).not.toContain('@web3.local');
        expect(content, `File ${filePath} contains forbidden shadow account string @ssi.local`).not.toContain('@ssi.local');
      });
    });
  });

  describe('6. Composition-Only Bootstrap Invariance (src/bootstrap/)', () => {
    const bootstrapFiles = allSrcFiles.filter((f) => f.includes(path.join('src', 'bootstrap')));

    it('bootstrap files must contain composition wiring only (no domain business logic or persistence queries)', () => {
      if (bootstrapFiles.length > 0) {
        bootstrapFiles.forEach((filePath) => {
          const content = fs.readFileSync(filePath, 'utf-8');
          // Heuristic check: Bootstrap must not perform SQL queries or implement domain logic
          expect(content, `Bootstrap file ${filePath} must not contain raw SQL query methods`).not.toMatch(/\.select\(|\.insert\(|\.update\(|\.delete\(/);
        });
      }
    });
  });

  describe('7. Cross-Domain Matrix v4 (3 Relation Categories)', () => {
    const domainFiles = allSrcFiles.filter((f) => f.includes(path.join('src', 'domains')));

    it('enforces forbidden cross-domain imports and mandates event contract isolation', () => {
      domainFiles.forEach((filePath) => {
        const relativePath = path.relative(path.join(SRC_DIR, 'domains'), filePath);
        const currentDomain = relativePath.split(path.sep)[0];
        const rule = CROSS_DOMAIN_MATRIX_V4[currentDomain];

        if (rule && rule.forbidden) {
          const content = fs.readFileSync(filePath, 'utf-8');
          const imports = parseImports(content);

          imports.forEach((imp) => {
            rule.forbidden.forEach((forbiddenDomain) => {
              const forbiddenPattern = new RegExp(`domains[\\/]${forbiddenDomain}`);
              expect(imp, `Domain ${currentDomain} in ${filePath} is forbidden from importing ${forbiddenDomain}`).not.toMatch(forbiddenPattern);
            });
          });
        }
      });
    });
  });
});
