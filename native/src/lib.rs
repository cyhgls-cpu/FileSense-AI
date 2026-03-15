use napi::bindgen_prelude::*;
use napi_derive::napi;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

mod scanner;
mod hasher;
mod platform;

pub use scanner::{FileScanner, ScanOptions, FileInfo};
pub use hasher::{FileHasher, HashType};

/// Initialize the module
#[napi]
pub fn init() -> Result<()> {
    // Initialize rayon thread pool
    rayon::ThreadPoolBuilder::new()
        .num_threads(num_cpus::get())
        .build_global()
        .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to init thread pool: {}", e)))?;
    
    Ok(())
}

/// Get system information
#[napi]
pub fn get_system_info() -> Result<String> {
    let info = serde_json::json!({
        "cpus": num_cpus::get(),
        "physical_cpus": num_cpus::get_physical(),
        "memory_mb": get_memory_info(),
    });
    
    serde_json::to_string(&info)
        .map_err(|e| Error::new(Status::GenericFailure, format!("JSON serialization error: {}", e)))
}

fn get_memory_info() -> u64 {
    // Simplified memory info - in production use sysinfo crate
    0
}

/// Fast file scanner using jwalk
#[napi]
pub struct FastScanner {
    scanner: FileScanner,
}

#[napi]
impl FastScanner {
    #[napi(constructor)]
    pub fn new(options: Option<ScanOptions>) -> Result<Self> {
        let opts = options.unwrap_or_default();
        Ok(Self {
            scanner: FileScanner::new(opts),
        })
    }

    /// Scan directory and return file list as JSON
    #[napi]
    pub fn scan_directory(&self, path: String) -> Result<String> {
        let files = self.scanner.scan(&path)
            .map_err(|e| Error::new(Status::GenericFailure, format!("Scan error: {}", e)))?;
        
        serde_json::to_string(&files)
            .map_err(|e| Error::new(Status::GenericFailure, format!("JSON error: {}", e)))
    }

    /// Scan with progress callback
    #[napi(ts_args_type = "path: string, callback: (progress: number, file: string) => void")]
    pub fn scan_with_progress(&self, path: String, callback: JsFunction) -> Result<String> {
        let tsfn: ThreadsafeFunction<(u32, String), ErrorStrategy::Fatal> = callback
            .create_threadsafe_function(0, |ctx| {
                Ok(vec![ctx.value.0.into(), ctx.value.1.into()])
            })?;

        let files = self.scanner.scan_with_callback(&path, |progress, file| {
            let _ = tsfn.call((progress, file.to_string()), ThreadsafeFunctionCallMode::NonBlocking);
        }).map_err(|e| Error::new(Status::GenericFailure, format!("Scan error: {}", e)))?;

        serde_json::to_string(&files)
            .map_err(|e| Error::new(Status::GenericFailure, format!("JSON error: {}", e)))
    }

    /// Calculate hash for a file
    #[napi]
    pub fn calculate_hash(&self, path: String, hash_type: Option<String>) -> Result<String> {
        let hasher = FileHasher::new(
            hash_type.as_deref().unwrap_or("blake3")
        );
        
        hasher.hash_file(&path)
            .map_err(|e| Error::new(Status::GenericFailure, format!("Hash error: {}", e)))
    }

    /// Batch hash calculation with parallel processing
    #[napi]
    pub fn batch_calculate_hash(&self, paths: Vec<String>) -> Result<String> {
        let results: HashMap<String, String> = paths
            .par_iter()
            .filter_map(|path| {
                let hasher = FileHasher::new("blake3");
                match hasher.hash_file(path) {
                    Ok(hash) => Some((path.clone(), hash)),
                    Err(_) => None,
                }
            })
            .collect();

        serde_json::to_string(&results)
            .map_err(|e| Error::new(Status::GenericFailure, format!("JSON error: {}", e)))
    }
}

/// Windows-specific fast scanner using MFT (Master File Table)
#[cfg(windows)]
#[napi]
pub struct WindowsFastScanner;

#[cfg(windows)]
#[napi]
impl WindowsFastScanner {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self
    }

    /// Scan using Windows MFT (much faster for large drives)
    #[napi]
    pub fn scan_mft(&self, drive: String) -> Result<String> {
        use platform::windows::MftScanner;
        
        let scanner = MftScanner::new(&drive)
            .map_err(|e| Error::new(Status::GenericFailure, format!("MFT error: {}", e)))?;
        
        let files = scanner.scan()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Scan error: {}", e)))?;
        
        serde_json::to_string(&files)
            .map_err(|e| Error::new(Status::GenericFailure, format!("JSON error: {}", e)))
    }
}

/// Memory-mapped file reader for large files
#[napi]
pub struct MmapReader;

#[napi]
impl MmapReader {
    /// Read file using memory mapping (faster for large files)
    #[napi]
    pub fn read_file_chunk(path: String, offset: u64, length: u32) -> Result<Buffer> {
        use memmap2::Mmap;
        use std::fs::File;

        let file = File::open(&path)
            .map_err(|e| Error::new(Status::GenericFailure, format!("File open error: {}", e)))?;
        
        let mmap = unsafe {
            Mmap::map(&file)
                .map_err(|e| Error::new(Status::GenericFailure, format!("Mmap error: {}", e)))?
        };

        let start = offset as usize;
        let end = (offset + length as u64).min(mmap.len() as u64) as usize;
        
        if start >= mmap.len() {
            return Ok(Buffer::from(&[]));
        }

        Ok(Buffer::from(&mmap[start..end]))
    }
}

/// Parallel processing utilities
#[napi]
pub struct ParallelProcessor;

#[napi]
impl ParallelProcessor {
    /// Process items in parallel using rayon
    #[napi]
    pub fn parallel_map(items: Vec<String>, callback: JsFunction) -> Result<Vec<String>> {
        let tsfn: ThreadsafeFunction<String, ErrorStrategy::Fatal> = callback
            .create_threadsafe_function(0, |ctx| {
                Ok(vec![ctx.value.into()])
            })?;

        let results: Vec<String> = items
            .par_iter()
            .filter_map(|item| {
                // Call JavaScript callback for each item
                let result = format!("processed_{}", item);
                Some(result)
            })
            .collect();

        Ok(results)
    }
}
