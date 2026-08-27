const fs = require('fs');
const path = require('path');

function getFiles(dir, files = []) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            getFiles(fullPath, files);
        } else {
            files.push(fullPath);
        }
    }
    return files;
}

const allFiles = getFiles('src');
let md = '# Backend Completo - Code Dump\n\nEste arquivo contém o código fonte integral de todos os arquivos de `src/` para análise de arquitetura em contexto único.\n\n';

for (const file of allFiles) {
    if (!file.endsWith('.ts') && !file.endsWith('.sql')) continue;
    const ext = path.extname(file).substring(1);
    const lang = ext === 'ts' ? 'typescript' : (ext === 'sql' ? 'sql' : 'text');
    const content = fs.readFileSync(file, 'utf8');
    
    md += `## \`${file}\`\n\n`;
    md += `\`\`\`${lang}\n`;
    md += content;
    md += `\n\`\`\`\n\n---\n\n`;
}

fs.writeFileSync('docs/backend_modules_full_code.md', md);
console.log('Dump gerado em docs/backend_modules_full_code.md');

const baseTree = fs.readFileSync('docs/backend_modules.md', 'utf8');
const fullDocs = baseTree + '\n\n' + md;
fs.writeFileSync('docs/backend_modules_with_code.md', fullDocs);
console.log('Dump gerado em docs/backend_modules_with_code.md');

