#!/usr/bin/env node
/**
 * FileSense AI 全平台打包脚本
 * 生成 Windows、macOS、Linux 的安装包和绿色包
 * 不包含模型文件以缩小体积
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const version = require('../package.json').version;
const distDir = path.join(__dirname, '..', 'dist');

console.log('========================================');
console.log('  FileSense AI 全平台打包工具');
console.log(`  版本: ${version}`);
console.log('========================================\n');

// 确保 dist 目录存在
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// 清理旧的构建文件
function cleanDist() {
  console.log('📁 清理旧的构建文件...');
  try {
    const files = fs.readdirSync(distDir);
    for (const file of files) {
      const filePath = path.join(distDir, file);
      const stat = fs.statSync(filePath);
      if (stat.isFile() && file.includes('FileSense')) {
        fs.unlinkSync(filePath);
        console.log(`   删除: ${file}`);
      }
    }
  } catch (err) {
    console.log('   无需清理或清理失败');
  }
  console.log('');
}

// 执行打包命令
function build(target) {
  console.log(`\n🚀 开始打包: ${target}`);
  console.log('----------------------------------------');
  try {
    execSync(`npx electron-builder ${target}`, {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });
    console.log(`✅ ${target} 打包完成\n`);
    return true;
  } catch (err) {
    console.error(`❌ ${target} 打包失败\n`);
    return false;
  }
}

// 列出生成的文件
function listArtifacts() {
  console.log('\n========================================');
  console.log('  生成的安装包文件');
  console.log('========================================');

  const files = fs.readdirSync(distDir);
  const artifacts = files.filter(f => f.includes('FileSense') || f.includes('filesense'));

  if (artifacts.length === 0) {
    console.log('未找到生成的文件');
    return;
  }

  // 按平台分组
  const groups = {
    'Windows': [],
    'macOS': [],
    'Linux': []
  };

  for (const file of artifacts) {
    const filePath = path.join(distDir, file);
    const stat = fs.statSync(filePath);
    const size = (stat.size / 1024 / 1024).toFixed(2) + ' MB';

    const info = { file, size };

    if (file.includes('Windows') || file.includes('.exe') || file.endsWith('.zip')) {
      if (!file.includes('macOS') && !file.includes('Linux')) {
        groups['Windows'].push(info);
      }
    } else if (file.includes('macOS') || file.endsWith('.dmg') || file.endsWith('.app')) {
      groups['macOS'].push(info);
    } else if (file.includes('Linux') || file.endsWith('.AppImage') || file.endsWith('.deb') || file.endsWith('.rpm') || file.endsWith('.tar.gz')) {
      groups['Linux'].push(info);
    }
  }

  for (const [platform, files] of Object.entries(groups)) {
    if (files.length > 0) {
      console.log(`\n📦 ${platform}:`);
      files.forEach(({ file, size }) => {
        console.log(`   • ${file} (${size})`);
      });
    }
  }

  console.log('\n========================================');
  console.log(`  输出目录: ${distDir}`);
  console.log('========================================\n');
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  const target = args[0];

  cleanDist();

  if (target === 'win') {
    build('--win');
  } else if (target === 'mac') {
    build('--mac');
  } else if (target === 'linux') {
    build('--linux');
  } else if (target === 'all') {
    console.log('🌍 开始全平台打包...\n');
    build('--win');
    build('--mac');
    build('--linux');
  } else {
    console.log('用法: node scripts/build-all.js [win|mac|linux|all]');
    console.log('');
    console.log('选项:');
    console.log('  win   - 仅打包 Windows 版本');
    console.log('  mac   - 仅打包 macOS 版本');
    console.log('  linux - 仅打包 Linux 版本');
    console.log('  all   - 打包所有平台 (默认)');
    console.log('');

    // 默认打包全部
    console.log('🌍 未指定目标，开始全平台打包...\n');
    build('--win');
    build('--mac');
    build('--linux');
  }

  listArtifacts();
}

main().catch(console.error);
