use blake3::Hasher;
use memmap2::Mmap;
use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

/// Hash types supported
pub enum HashType {
    Blake3,
    Md5,
    Sha256,
    Sparse,  // Fast sparse hash (head + middle + tail)
}

impl From<&str> for HashType {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "blake3" => HashType::Blake3,
            "md5" => HashType::Md5,
            "sha256" => HashType::Sha256,
            "sparse" => HashType::Sparse,
            _ => HashType::Blake3,
        }
    }
}

/// File hasher with multiple algorithm support
pub struct FileHasher {
    hash_type: HashType,
    chunk_size: usize,
}

impl FileHasher {
    pub fn new(hash_type: &str) -> Self {
        Self {
            hash_type: HashType::from(hash_type),
            chunk_size: 4096, // 4KB chunks
        }
    }

    pub fn with_chunk_size(mut self, size: usize) -> Self {
        self.chunk_size = size;
        self
    }

    /// Hash entire file
    pub fn hash_file<P: AsRef<Path>>(&self, path: P) -> Result<String, String> {
        let path = path.as_ref();
        
        match self.hash_type {
            HashType::Blake3 => self.hash_blake3(path),
            HashType::Md5 => self.hash_md5(path),
            HashType::Sha256 => self.hash_sha256(path),
            HashType::Sparse => self.hash_sparse(path),
        }
    }

    /// Fast hash using memory mapping
    pub fn hash_file_mmap<P: AsRef<Path>>(&self, path: P) -> Result<String, String> {
        let path = path.as_ref();
        let file = File::open(path)
            .map_err(|e| format!("Failed to open file: {}", e))?;

        let mmap = unsafe {
            Mmap::map(&file)
                .map_err(|e| format!("Failed to mmap file: {}", e))?
        };

        match self.hash_type {
            HashType::Blake3 => {
                let hash = blake3::hash(&mmap);
                Ok(hash.to_hex().to_string())
            }
            _ => Err("Mmap hashing only supported for Blake3".to_string()),
        }
    }

    /// Calculate sparse hash (fast, for initial dedup)
    /// Samples: first 4KB, middle 4KB, last 4KB
    pub fn hash_sparse<P: AsRef<Path>>(&self, path: P) -> Result<String, String> {
        let path = path.as_ref();
        let file = File::open(path)
            .map_err(|e| format!("Failed to open file: {}", e))?;
        
        let metadata = file.metadata()
            .map_err(|e| format!("Failed to get metadata: {}", e))?;
        
        let file_size = metadata.len();
        
        // Small files: hash entire content
        if file_size <= (self.chunk_size * 3) as u64 {
            return self.hash_blake3(path);
        }

        let mut hasher = Hasher::new();
        let sample_size = self.chunk_size as u64;

        // Read first chunk
        let mut buffer = vec![0u8; self.chunk_size];
        let mut reader = io::BufReader::new(&file);
        reader.read_exact(&mut buffer)
            .map_err(|e| format!("Failed to read first chunk: {}", e))?;
        hasher.update(&buffer);

        // Read middle chunk
        let middle_offset = file_size / 2 - sample_size / 2;
        #[cfg(windows)]
        {
            use std::os::windows::fs::FileExt;
            file.seek_read(&mut buffer, middle_offset)
                .map_err(|e| format!("Failed to read middle chunk: {}", e))?;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::FileExt;
            file.read_at(&mut buffer, middle_offset)
                .map_err(|e| format!("Failed to read middle chunk: {}", e))?;
        }
        hasher.update(&buffer);

        // Read last chunk
        let last_offset = file_size - sample_size;
        #[cfg(windows)]
        {
            use std::os::windows::fs::FileExt;
            file.seek_read(&mut buffer, last_offset)
                .map_err(|e| format!("Failed to read last chunk: {}", e))?;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::FileExt;
            file.read_at(&mut buffer, last_offset)
                .map_err(|e| format!("Failed to read last chunk: {}", e))?;
        }
        hasher.update(&buffer);

        // Include file size in hash
        hasher.update(&file_size.to_le_bytes());

        Ok(hasher.finalize().to_hex().to_string())
    }

    /// Blake3 hash (fast, modern)
    fn hash_blake3<P: AsRef<Path>>(&self, path: P) -> Result<String, String> {
        let path = path.as_ref();
        let mut file = File::open(path)
            .map_err(|e| format!("Failed to open file: {}", e))?;

        let mut hasher = Hasher::new();
        let mut buffer = vec![0u8; self.chunk_size];

        loop {
            match file.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => hasher.update(&buffer[..n]),
                Err(e) => return Err(format!("Read error: {}", e)),
            }
        }

        Ok(hasher.finalize().to_hex().to_string())
    }

    /// MD5 hash (legacy compatibility)
    fn hash_md5<P: AsRef<Path>>(&self, path: P) -> Result<String, String> {
        use md5::{Digest, Md5};
        
        let path = path.as_ref();
        let mut file = File::open(path)
            .map_err(|e| format!("Failed to open file: {}", e))?;

        let mut hasher = Md5::new();
        let mut buffer = vec![0u8; self.chunk_size];

        loop {
            match file.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => hasher.update(&buffer[..n]),
                Err(e) => return Err(format!("Read error: {}", e)),
            }
        }

        let result = hasher.finalize();
        Ok(format!("{:x}", result))
    }

    /// SHA256 hash (secure)
    fn hash_sha256<P: AsRef<Path>>(&self, path: P) -> Result<String, String> {
        use sha2::{Digest, Sha256};
        
        let path = path.as_ref();
        let mut file = File::open(path)
            .map_err(|e| format!("Failed to open file: {}", e))?;

        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; self.chunk_size];

        loop {
            match file.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => hasher.update(&buffer[..n]),
                Err(e) => return Err(format!("Read error: {}", e)),
            }
        }

        let result = hasher.finalize();
        Ok(format!("{:x}", result))
    }

    /// Calculate rolling hash for similarity detection
    pub fn rolling_hash<P: AsRef<Path>>(&self, path: P) -> Result<Vec<u64>, String> {
        let path = path.as_ref();
        let file = File::open(path)
            .map_err(|e| format!("Failed to open file: {}", e))?;
        
        let mmap = unsafe {
            Mmap::map(&file)
                .map_err(|e| format!("Failed to mmap file: {}", e))?
        };

        let window_size = 64; // 64-byte window
        let mut hashes = Vec::new();
        
        if mmap.len() < window_size {
            return Ok(hashes);
        }

        // Simple Rabin fingerprint
        let base: u64 = 256;
        let prime: u64 = 1_000_000_007;
        
        let mut hash: u64 = 0;
        let mut pow: u64 = 1;

        // Initial window
        for i in 0..window_size {
            hash = (hash * base + mmap[i] as u64) % prime;
            if i < window_size - 1 {
                pow = (pow * base) % prime;
            }
        }
        hashes.push(hash);

        // Rolling hash
        for i in window_size..mmap.len() {
            let old_byte = mmap[i - window_size] as u64;
            let new_byte = mmap[i] as u64;
            
            hash = (hash + prime - (old_byte * pow) % prime) % prime;
            hash = (hash * base + new_byte) % prime;
            
            hashes.push(hash);
        }

        Ok(hashes)
    }
}

/// SimHash for near-duplicate detection
pub struct SimHash;

impl SimHash {
    /// Calculate SimHash for text content
    pub fn calculate(text: &str) -> u64 {
        let mut vec = vec![0i32; 64];
        
        // Simple word-based hashing
        for word in text.split_whitespace() {
            let hash = Self::hash_word(word);
            for i in 0..64 {
                let bit = (hash >> i) & 1;
                if bit == 1 {
                    vec[i] += 1;
                } else {
                    vec[i] -= 1;
                }
            }
        }

        // Build final hash
        let mut result: u64 = 0;
        for i in 0..64 {
            if vec[i] > 0 {
                result |= 1 << i;
            }
        }

        result
    }

    fn hash_word(word: &str) -> u64 {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        
        let mut hasher = DefaultHasher::new();
        word.hash(&mut hasher);
        hasher.finish()
    }

    /// Calculate Hamming distance between two SimHashes
    pub fn hamming_distance(a: u64, b: u64) -> u32 {
        (a ^ b).count_ones()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_blake3_hash() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        fs::write(&file_path, "test content").unwrap();

        let hasher = FileHasher::new("blake3");
        let hash = hasher.hash_file(&file_path).unwrap();
        
        assert_eq!(hash.len(), 64); // Blake3 produces 256-bit (64 hex chars) hash
    }

    #[test]
    fn test_sparse_hash() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("large.bin");
        
        // Create 100KB file
        let data = vec![0u8; 100_000];
        fs::write(&file_path, &data).unwrap();

        let hasher = FileHasher::new("sparse");
        let hash = hasher.hash_sparse(&file_path).unwrap();
        
        assert_eq!(hash.len(), 64);
    }

    #[test]
    fn test_simhash() {
        let text1 = "hello world foo bar";
        let text2 = "hello world foo baz";
        
        let hash1 = SimHash::calculate(text1);
        let hash2 = SimHash::calculate(text2);
        
        let distance = SimHash::hamming_distance(hash1, hash2);
        assert!(distance < 10); // Similar texts should have small Hamming distance
    }
}
