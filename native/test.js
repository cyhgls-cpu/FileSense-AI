/**
 * Test script for the native scanner module
 */

const path = require('path');
const fs = require('fs');

// Create test directory
const testDir = path.join(__dirname, 'test_data');

function setup() {
  console.log('Setting up test data...');
  
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  // Create some test files
  for (let i = 0; i < 100; i++) {
    const content = `Test file content ${i} `.repeat(100);
    fs.writeFileSync(path.join(testDir, `file${i}.txt`), content);
  }

  // Create subdirectories
  for (let i = 0; i < 5; i++) {
    const subDir = path.join(testDir, `subdir${i}`);
    fs.mkdirSync(subDir, { recursive: true });
    
    for (let j = 0; j < 20; j++) {
      fs.writeFileSync(
        path.join(subDir, `nested${j}.txt`),
        `Nested content ${i}-${j}`
      );
    }
  }

  console.log('Test data created.');
}

function cleanup() {
  console.log('Cleaning up test data...');
  
  const rimraf = (dir) => {
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach((file) => {
        const curPath = path.join(dir, file);
        if (fs.lstatSync(curPath).isDirectory()) {
          rimraf(curPath);
        } else {
          fs.unlinkSync(curPath);
        }
      });
      fs.rmdirSync(dir);
    }
  };

  rimraf(testDir);
  console.log('Cleanup complete.');
}

function runTests() {
  console.log('\n=== Native Scanner Tests ===\n');

  let native;
  try {
    native = require('./index.js');
  } catch (err) {
    console.error('Failed to load native module:', err.message);
    process.exit(1);
  }

  // Test 1: Init
  console.log('Test 1: Initialize module');
  try {
    native.init();
    console.log('✓ Module initialized\n');
  } catch (err) {
    console.error('✗ Init failed:', err.message);
    return;
  }

  // Test 2: System info
  console.log('Test 2: Get system info');
  try {
    const info = JSON.parse(native.getSystemInfo());
    console.log('System info:', info);
    console.log('✓ System info retrieved\n');
  } catch (err) {
    console.error('✗ System info failed:', err.message);
  }

  // Test 3: FastScanner
  console.log('Test 3: FastScanner');
  try {
    const scanner = new native.FastScanner({
      threads: 4,
      skipHidden: true,
    });

    console.time('Scan');
    const result = scanner.scanDirectory(testDir);
    console.timeEnd('Scan');

    const files = JSON.parse(result);
    console.log(`Found ${files.length} files`);
    
    if (files.length === 200) {
      console.log('✓ Correct number of files found\n');
    } else {
      console.error(`✗ Expected 200 files, got ${files.length}\n`);
    }
  } catch (err) {
    console.error('✗ Scan failed:', err.message);
    console.error(err.stack);
  }

  // Test 4: Hash calculation
  console.log('Test 4: Hash calculation');
  try {
    const scanner = new native.FastScanner();
    const testFile = path.join(testDir, 'file0.txt');
    
    console.time('Hash');
    const hash = scanner.calculateHash(testFile, 'blake3');
    console.timeEnd('Hash');
    
    console.log('Hash:', hash);
    console.log('✓ Hash calculated\n');
  } catch (err) {
    console.error('✗ Hash failed:', err.message);
  }

  // Test 5: Batch hash
  console.log('Test 5: Batch hash calculation');
  try {
    const scanner = new native.FastScanner();
    const files = Array.from({ length: 10 }, (_, i) => 
      path.join(testDir, `file${i}.txt`)
    );
    
    console.time('BatchHash');
    const result = scanner.batchCalculateHash(files);
    console.timeEnd('BatchHash');
    
    const hashes = JSON.parse(result);
    console.log(`Calculated ${Object.keys(hashes).length} hashes`);
    console.log('✓ Batch hash complete\n');
  } catch (err) {
    console.error('✗ Batch hash failed:', err.message);
  }

  // Test 6: Progress callback
  console.log('Test 6: Scan with progress callback');
  try {
    const scanner = new native.FastScanner();
    let progressCalls = 0;
    
    const result = scanner.scanWithProgress(testDir, (progress, file) => {
      progressCalls++;
      if (progressCalls % 50 === 0) {
        process.stdout.write(`\rProgress: ${progress}%`);
      }
    });
    
    console.log(`\n✓ Progress callback called ${progressCalls} times\n`);
  } catch (err) {
    console.error('✗ Progress scan failed:', err.message);
  }

  console.log('=== All Tests Complete ===');
}

// Main
setup();
runTests();
cleanup();
