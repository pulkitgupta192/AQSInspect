const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

function walk(dir, cb) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, cb);
    else cb(full);
  }
}

const exts = new Set(['.js', '.jsx', '.mjs', '.cjs']);
const root = path.resolve(__dirname, '..');
let errors = [];

walk(root, (file) => {
  if (!exts.has(path.extname(file))) return;
  // skip node_modules and build artifacts
  if (file.includes('node_modules') || file.includes('.vite') || file.includes('renderer/dist')) return;

  const code = fs.readFileSync(file, 'utf8');
  try {
    parser.parse(code, { sourceType: 'unambiguous', plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'] });
  } catch (e) {
    errors.push({ file, message: e.message });
  }
});

if (!errors.length) {
  console.log('✅ Syntax check passed (no parse errors)');
  process.exit(0);
}

console.error('❌ Syntax errors found:');
for (const e of errors) {
  console.error(`- ${e.file}: ${e.message}`);
}
process.exit(2);
