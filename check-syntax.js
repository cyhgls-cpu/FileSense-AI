const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);

if (match) {
  try {
    new Function(match[1]);
    console.log('✓ JS语法检查通过');
  } catch (e) {
    console.error('✗ JS语法错误:', e.message);
    console.error('位置:', e.stack);
  }
} else {
  console.log('未找到 script 标签');
}
