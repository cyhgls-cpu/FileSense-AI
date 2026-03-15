/**
 * Rust Native Module - File Scanner N-API Bindings
 * 
 * This module provides JavaScript bindings for the high-performance Rust scanner.
 * 
 * Usage:
 *   const { FastScanner, init } = require('./native');
 *   init();
 *   const scanner = new FastScanner({ threads: 8 });
 *   const files = scanner.scanDirectory('C:\\Users');
 */

const { existsSync } = require('fs');
const { join } = require('path');

// Try to load the native module
let native;

try {
  // Try release build first
  const releasePath = join(__dirname, 'target', 'release', 'file_scanner.node');
  const debugPath = join(__dirname, 'target', 'debug', 'file_scanner.node');
  
  if (existsSync(releasePath)) {
    native = require(releasePath);
  } else if (existsSync(debugPath)) {
    native = require(debugPath);
  } else {
    throw new Error('Native module not found. Please run: cd native && npm run build');
  }
} catch (err) {
  console.error('Failed to load native module:', err.message);
  console.error('Please build the Rust module first:');
  console.error('  cd native');
  console.error('  npm run build');
  
  // Export a fallback implementation
  module.exports = require('./fallback');
  return;
}

// Export all native functions
module.exports = {
  // Initialization
  init: native.init,
  getSystemInfo: native.getSystemInfo,
  
  // Main scanner
  FastScanner: native.FastScanner,
  
  // Windows-specific (only on Windows)
  ...(native.WindowsFastScanner && { WindowsFastScanner: native.WindowsFastScanner }),
  
  // Utilities
  MmapReader: native.MmapReader,
  ParallelProcessor: native.ParallelProcessor,
};
