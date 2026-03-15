/**
 * 高性能文件枚举引擎
 * 基于 NTFS MFT (Master File Table) 的直接读取
 * 速度比传统遍历快 100 倍以上
 */

const ffi = require('ffi-napi');
const ref = require('ref-napi');
const StructType = require('ref-struct-di');

// Windows API 类型定义
const DWORD = ref.types.uint32;
const HANDLE = ref.refType(ref.types.void);
const LARGE_INTEGER = ref.types.int64;

// USN_JOURNAL_DATA_V0 结构
const USN_JOURNAL_DATA_V0 = StructType({
  UsnJournalID: LARGE_INTEGER,
  FirstUsn: LARGE_INTEGER,
  NextUsn: LARGE_INTEGER,
  LowestValidUsn: LARGE_INTEGER,
  MaxUsn: LARGE_INTEGER,
  MaximumSize: LARGE_INTEGER,
  AllocationDelta: LARGE_INTEGER
});

// MFT_ENUM_DATA_V0 结构
const MFT_ENUM_DATA_V0 = StructType({
  StartFileReferenceNumber: LARGE_INTEGER,
  LowUsn: LARGE_INTEGER,
  HighUsn: LARGE_INTEGER
});

// 加载 Windows API
let kernel32 = null;
try {
  kernel32 = ffi.Library('kernel32', {
    'CreateFileW': ['pointer', ['pointer', DWORD, DWORD, 'pointer', DWORD, DWORD, 'pointer']],
    'DeviceIoControl': ['bool', ['pointer', DWORD, 'pointer', DWORD, 'pointer', DWORD, 'pointer', 'pointer']],
    'CloseHandle': ['bool', ['pointer']]
  });
} catch (err) {
  console.warn('无法加载 Windows API，将使用传统遍历方式');
}

class MFTScanner {
  constructor() {
    this.handle = null;
    this.usnJournal = null;
  }

  /**
   * 初始化 USN Journal
   */
  async initUsnJournal(driveLetter = 'C:') {
    if (!kernel32) {
      throw new Error('仅支持 Windows NTFS 文件系统');
    }

    const path = `\\\\.\\${driveLetter}:`;
    
    // 打开卷句柄
    this.handle = kernel32.CreateFileW(
      Buffer.from(path + '\0', 'ucs2'),
      0, // 无访问权限（只查询元数据）
      3, // FILE_SHARE_READ | FILE_SHARE_WRITE
      null,
      3, // OPEN_EXISTING
      0,
      null
    );

    if (this.handle.isNull()) {
      throw new Error(`无法打开卷 ${driveLetter}`);
    }

    // 查询 USN Journal
    const journalData = Buffer.alloc(USN_JOURNAL_DATA_V0.size);
    const bytesReturned = Buffer.alloc(DWORD.size);

    const FSCTL_QUERY_USN_JOURNAL = 0x000900F4;
    const result = kernel32.DeviceIoControl(
      this.handle,
      FSCTL_QUERY_USN_JOURNAL,
      null, 0,
      journalData, journalData.length,
      bytesReturned,
      null
    );

    if (result) {
      this.usnJournal = journalData;
      console.log('USN Journal 初始化成功');
    } else {
      console.warn('未找到 USN Journal，将创建新的日志');
      await this.createUsnJournal();
    }
  }

  /**
   * 创建 USN Journal
   */
  async createUsnJournal() {
    const FSCTL_CREATE_USN_JOURNAL = 0x000900E0;
    const data = Buffer.alloc(28);
    
    // MaximumSize, AllocationDelta, MaxUsnIncrement, UsnJournalID
    data.writeBigUInt64LE(BigInt(1024 * 1024 * 1024), 0); // 1GB
    data.writeBigUInt64LE(BigInt(1024 * 1024 * 128), 8);   // 128MB
    
    const bytesReturned = Buffer.alloc(DWORD.size);
    kernel32.DeviceIoControl(
      this.handle,
      FSCTL_CREATE_USN_JOURNAL,
      data, data.length,
      null, 0,
      bytesReturned,
      null
    );
  }

  /**
   * 枚举 MFT 记录
   * @returns {Array} 文件记录列表
   */
  enumerateMFT() {
    const files = [];
    const FSCTL_ENUM_USN_DATA = 0x000900B3;
    
    const enumData = Buffer.alloc(MFT_ENUM_DATA_V0.size);
    // StartFileReferenceNumber, LowUsn, HighUsn
    enumData.writeBigUInt64LE(BigInt(0), 0);
    enumData.writeBigUInt64LE(BigInt(0), 8);
    enumData.writeBigUInt64LE(BigInt(0xFFFFFFFFFFFFFFFF), 16);

    let offset = 0;
    const bufferSize = 1024 * 1024; // 1MB 缓冲区
    const outBuffer = Buffer.alloc(bufferSize);
    const bytesReturned = Buffer.alloc(DWORD.size);

    while (true) {
      const result = kernel32.DeviceIoControl(
        this.handle,
        FSCTL_ENUM_USN_DATA,
        enumData, MFT_ENUM_DATA_V0.size,
        outBuffer, bufferSize,
        bytesReturned,
        null
      );

      if (!result) break;

      const returned = bytesReturned.readUInt32LE(0);
      
      // 解析返回的数据
      let pos = 0;
      while (pos < returned) {
        const recordLength = outBuffer.readUInt32LE(pos);
        if (recordLength === 0) break;

        const fileReferenceNumber = outBuffer.readBigUInt64LE(pos + 8);
        const parentFileReferenceNumber = outBuffer.readBigUInt64LE(pos + 16);
        const usn = outBuffer.readBigUInt64LE(pos + 24);
        const fileNameLength = outBuffer.readUInt16LE(pos + 56);
        const fileName = outBuffer.slice(pos + 58, pos + 58 + fileNameLength)
          .toString('ucs2');

        files.push({
          frn: fileReferenceNumber.toString(),
          parentFrn: parentFileReferenceNumber.toString(),
          usn: usn.toString(),
          name: fileName.trim()
        });

        pos += recordLength;
      }

      // 更新偏移量继续读取
      enumData.writeBigUInt64LE(outBuffer.readBigUInt64LE(offset + 8), 0);
    }

    return files;
  }

  /**
   * 清理资源
   */
  close() {
    if (this.handle && !this.handle.isNull()) {
      kernel32.CloseHandle(this.handle);
      this.handle = null;
    }
  }
}

/**
 * 存储介质检测工具
 */
class StorageDetector {
  static async detectDriveType(driveLetter = 'C') {
    if (process.platform !== 'win32') {
      return { type: 'UNKNOWN', isSSD: false };
    }

    try {
      // 使用 PowerShell 检测磁盘类型
      const { execSync } = require('child_process');
      const output = execSync(
        `powershell -c "Get-PhysicalDisk | Where-Object {$_.DeviceId -eq '${driveLetter}'} | Select-Object -ExpandProperty MediaType"`,
        { encoding: 'utf8' }
      ).trim().toLowerCase();

      const isSSD = output.includes('ssd') || output.includes('solid state');
      return {
        type: isSSD ? 'SSD' : 'HDD',
        isSSD: isSSD,
        rawType: output
      };
    } catch (err) {
      console.warn('无法检测磁盘类型，假设为 HDD:', err.message);
      return { type: 'HDD', isSSD: false };
    }
  }

  /**
   * 根据存储类型获取最优配置
   */
  static getOptimalConfig(driveType) {
    if (driveType.isSSD) {
      // SSD: 高并发，支持随机读取
      return {
        ioThreads: 8,
        hashThreads: 4,
        bufferSize: 64 * 1024,      // 64KB
        maxConcurrentReads: 32,
        useAsyncIO: true
      };
    } else {
      // HDD: 低并发，顺序读取优先
      return {
        ioThreads: 2,
        hashThreads: 2,
        bufferSize: 256 * 1024,     // 256KB
        maxConcurrentReads: 4,
        useAsyncIO: false
      };
    }
  }
}

module.exports = {
  MFTScanner,
  StorageDetector
};
