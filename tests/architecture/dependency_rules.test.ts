import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { FINANCIAL_DEPRECATED_LIMIT_ALIASES } from '../../src/domains/finance/constants/FinancialLimits';

const SRC_DIR = path.resolve(__dirname, '../../src');

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []) {
  if (!fs.existsSync(dirPath)) return arrayOfFiles;
  
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    if (fs.statSync(path.join(dirPath, file)).isDirectory()) {
      arrayOfFiles = getAllFiles(path.join(dirPath, file), arrayOfFiles);
    } else {
      if (file.endsWith('.ts') && !file.endsWith('.test.ts')) {
        arrayOfFiles.push(path.join(dirPath, file));
      }
    }
  });

  return arrayOfFiles;
}

function checkImports(fileContent: string, forbiddenPatterns: string[]): boolean {
  const lines = fileContent.split('\n');
  for (const line of lines) {
    if (line.trim().startsWith('import ') || line.trim().includes('from \'')) {
      for (const pattern of forbiddenPatterns) {
        if (line.includes(pattern)) {
          return true; // Found forbidden import
        }
      }
    }
  }
  return false;
}

describe('Architecture Dependency Rules', () => {
  it('Domain layer must NOT import from infrastructure or interfaces', () => {
    const domainDir = path.join(SRC_DIR, 'domains');
    const domainFiles = getAllFiles(domainDir);
    const forbiddenPatterns = [
      '/infrastructure/',
      '/interfaces/',
      '../infrastructure/',
      '../interfaces/',
      '../../infrastructure/',
      '../../interfaces/',
      '../../../infrastructure/',
      '../../../interfaces/'
    ];

    const violatingFiles: string[] = [];

    domainFiles.forEach((file) => {
      const content = fs.readFileSync(file, 'utf-8');
      if (checkImports(content, forbiddenPatterns)) {
        violatingFiles.push(file.replace(SRC_DIR, ''));
      }
    });

    expect(violatingFiles, `Domain files violating dependency rules by importing from infrastructure/interfaces: \n${violatingFiles.join('\n')}`).toEqual([]);
  });

  it('Application layer must NOT import deprecated aliases from FINANCIAL_DEPRECATED_LIMIT_ALIASES', () => {
    const appDir = path.join(SRC_DIR, 'application');
    const appFiles = getAllFiles(appDir);
    const violatingFiles: { file: string; deprecatedIdentifier: string }[] = [];

    const importBlockRegex = /import\s+[\s\S]*?from\s+['"][^'"]+['"]/g;

    appFiles.forEach((file) => {
      const content = fs.readFileSync(file, 'utf-8');
      const importBlocks = content.match(importBlockRegex) || [];

      for (const block of importBlocks) {
        for (const alias of FINANCIAL_DEPRECATED_LIMIT_ALIASES) {
          const aliasWordRegex = new RegExp(`\\b${alias}\\b`);
          if (aliasWordRegex.test(block)) {
            violatingFiles.push({
              file: file.replace(SRC_DIR, ''),
              deprecatedIdentifier: alias,
            });
          }
        }
      }
    });

    expect(
      violatingFiles,
      `Application files violating governance rules by importing deprecated FinancialLimits aliases: \n${JSON.stringify(violatingFiles, null, 2)}`
    ).toEqual([]);
  });
});

