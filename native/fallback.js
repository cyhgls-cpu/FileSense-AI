/**
 * Fallback implementation when native module is not available
 * Uses JavaScript implementations for compatibility
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

class FastScanner {
  constructor(options = {}) {
    this.options = {
      threads: options.threads || 4,
      followSymlinks: options.followSymlinks || false,
      maxDepth: options.maxDepth || null,
      skipHidden: options.skipHidden !== false,
    };
  }

  scanDirectory(dirPath) {
    // Fallback to Node.js implementation
    const files = [];
    
    const scan = (currentPath, depth = 0) => {
      if (this.options.maxDepth && depth > this.options.maxDepth) {
        return;
      }

      try {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);
          
          if (this.options.skipHidden && entry.name.startsWith('.')) {
            continue;
          }

          if (entry.isDirectory()) {
            if (this.options.followSymlinks || !entry.isSymbolicLink()) {
              scan(fullPath, depth + 1);
            }
          } else {
            try {
              const stats = fs.statSync(fullPath);
              files.push({
                path: fullPath,
                size: stats.size,
                modifiedTime: stats.mtimeMs,
                createdTime: stats.birthtimeMs || stats.ctimeMs,
                isDirectory: false,
                extension: path.extname(entry.name).slice(1),
                category: this._categorize(entry.name),
              });
            } catch (e) {
              // Skip files we can't stat
            }
          }
        }
      } catch (e) {
        // Skip directories we can't read
      }
    };

    scan(dirPath);
    return JSON.stringify(files);
  }

  calculateHash(filePath, hashType = 'blake3') {
    // Fallback to simple hash
    const crypto = require('crypto');
    const content = fs.readFileSync(filePath);
    const hash = crypto.createHash('md5').update(content).digest('hex');
    return hash;
  }

  batchCalculateHash(paths) {
    const results = {};
    for (const p of paths) {
      try {
        results[p] = this.calculateHash(p);
      } catch (e) {
        // Skip files we can't hash
      }
    }
    return JSON.stringify(results);
  }

  _categorize(filename) {
    const ext = path.extname(filename).toLowerCase();
    const categories = {
      software: ['.exe', '.dll', '.msi', '.pkg', '.deb', '.rpm', '.app', '.apk', '.ipa'],
      image: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico', '.psd', '.ai'],
      video: ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'],
      audio: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma'],
      document: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md'],
      archive: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'],
      code: ['.js', '.ts', '.py', '.java', '.cpp', '.c', '.h', '.rs', '.go'],
    };

    for (const [cat, exts] of Object.entries(categories)) {
      if (exts.includes(ext)) return cat;
    }
    return 'other';
  }
}

class MmapReader {
  static readFileChunk(filePath, offset, length) {
    // Fallback to regular read
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, offset);
    fs.closeSync(fd);
    return buffer;
  }
}

function init() {
  console.log('[Fallback] Using JavaScript implementation (Rust native module not available)');
}

function getSystemInfo() {
  const os = require('os');
  return JSON.stringify({
    cpus: os.cpus().length,
    physicalCpus: os.cpus().length, // Approximation
    memoryMb: Math.round(os.totalmem() / 1024 / 1024),
    isFallback: true,
  });
}

module.exports = {
  init,
  getSystemInfo,
  FastScanner,
  MmapReader,
  ParallelProcessor: class {
    static parallelMap(items, callback) {
      // Simple synchronous fallback
      return items.map(callback);
    }
  },
};
