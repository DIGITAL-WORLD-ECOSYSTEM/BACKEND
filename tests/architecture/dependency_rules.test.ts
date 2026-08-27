import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';

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
});
