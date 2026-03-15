/**
 * Move the compiled Rust binary to the correct location
 */

const fs = require('fs');
const path = require('path');

const isDebug = process.argv.includes('--debug');
const buildType = isDebug ? 'debug' : 'release';

// Determine platform-specific extension
const platform = process.platform;
const ext = platform === 'win32' ? '.dll' : platform === 'darwin' ? '.dylib' : '.so';
const nodeExt = '.node';

// Source and destination paths
const sourceDir = path.join(__dirname, '..', 'target', buildType);
const destDir = path.join(__dirname, '..');

// Find the compiled library
const libName = platform === 'win32' 
  ? `file_scanner${ext}`
  : platform === 'darwin'
    ? `libfile_scanner${ext}`
    : `libfile_scanner${ext}`;

const sourcePath = path.join(sourceDir, libName);
const destPath = path.join(destDir, `file_scanner${nodeExt}`);

// Also check for .node file (N-API output)
const nodeSourcePath = path.join(sourceDir, `file_scanner${nodeExt}`);

if (fs.existsSync(nodeSourcePath)) {
  console.log(`Copying ${nodeSourcePath} to ${destPath}`);
  fs.copyFileSync(nodeSourcePath, destPath);
  console.log('Done!');
} else if (fs.existsSync(sourcePath)) {
  console.log(`Copying ${sourcePath} to ${destPath}`);
  fs.copyFileSync(sourcePath, destPath);
  console.log('Done!');
} else {
  console.error(`Error: Could not find compiled binary at ${sourcePath} or ${nodeSourcePath}`);
  console.error('Make sure the Rust build completed successfully.');
  process.exit(1);
}
