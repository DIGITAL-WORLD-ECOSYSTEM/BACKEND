import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function walkDir(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (!filePath.includes('node_modules') && !filePath.includes('.git') && !filePath.includes('dist')) {
        walkDir(filePath, fileList);
      }
    } else if (filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.js')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

describe('AF-012 Static Architecture & Anti-Shadow Account Governance', () => {
  const srcPath = path.resolve(__dirname, '../src');
  const sourceFiles = walkDir(srcPath);

  it('prohibits pseudo-domain shadow account email patterns (@web3.local, @ssi.local)', () => {
    const forbiddenPatterns = ['@web3.local', '@ssi.local', '@passkey.local'];
    const violations: { file: string; pattern: string }[] = [];

    for (const filePath of sourceFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const pattern of forbiddenPatterns) {
        if (content.includes(pattern)) {
          violations.push({ file: filePath, pattern });
        }
      }
    }

    expect(violations, `Shadow account pseudo-domains found: ${JSON.stringify(violations)}`).toEqual([]);
  });
});
