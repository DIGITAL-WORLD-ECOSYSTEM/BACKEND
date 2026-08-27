const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function generateDocs(outputFile) {
  const files = execSync('find src -type f -name "*.ts"').toString().trim().split('\n');
  let content = '# ASPPIBRA Backend Full Code\n\n';
  
  for (const file of files) {
    if (!file) continue;
    content += `## File: ${file}\n\n\`\`\`typescript\n`;
    content += fs.readFileSync(file, 'utf-8');
    content += '\n\`\`\`\n\n';
  }
  
  fs.writeFileSync(outputFile, content);
  console.log('Generated ' + outputFile);
}

generateDocs('docs/backend_modules_full_code.md');
generateDocs('docs/backend_modules_with_code.md');
