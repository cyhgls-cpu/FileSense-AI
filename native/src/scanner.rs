use jwalk::{WalkDir, WalkDirGeneric};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

/// File information structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub size: u64,
    pub modified_time: u64,
    pub created_time: u64,
    pub is_directory: bool,
    pub extension: String,
    pub category: String,
}

/// Scan options
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanOptions {
    pub follow_symlinks: bool,
    pub max_depth: Option<usize>,
    pub threads: usize,
    pub skip_hidden: bool,
    pub extensions: Option<Vec<String>>,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            follow_symlinks: false,
            max_depth: None,
            threads: num_cpus::get(),
            skip_hidden: true,
            extensions: None,
        }
    }
}

/// High-performance file scanner using jwalk
pub struct FileScanner {
    options: ScanOptions,
}

impl FileScanner {
    pub fn new(options: ScanOptions) -> Self {
        Self { options }
    }

    /// Fast parallel directory scan
    pub fn scan<P: AsRef<Path>>(&self, path: P) -> Result<Vec<FileInfo>, String> {
        let path = path.as_ref();
        
        if !path.exists() {
            return Err(format!("Path does not exist: {}", path.display()));
        }

        let files = Arc::new(Mutex::new(Vec::with_capacity(10000)));
        let counter = Arc::new(AtomicUsize::new(0));

        // Configure jwalk with parallel processing
        let walk = WalkDir::new(path)
            .parallelism(jwalk::Parallelism::RayonNewPool(self.options.threads))
            .follow_links(self.options.follow_symlinks)
            .skip_hidden(self.options.skip_hidden);

        let walk = if let Some(depth) = self.options.max_depth {
            walk.max_depth(depth)
        } else {
            walk
        };

        // Process entries in parallel
        walk.into_iter()
            .filter_map(|entry| entry.ok())
            .for_each(|entry| {
                let path = entry.path();
                
                // Skip if extension filter is set and doesn't match
                if let Some(ref exts) = self.options.extensions {
                    if let Some(ext) = path.extension() {
                        let ext = ext.to_string_lossy().to_lowercase();
                        if !exts.iter().any(|e| e.to_lowercase() == ext) {
                            return;
                        }
                    } else {
                        return;
                    }
                }

                if let Ok(metadata) = entry.metadata() {
                    let file_info = FileInfo {
                        path: path.to_string_lossy().to_string(),
                        size: metadata.len(),
                        modified_time: metadata.modified()
                            .ok()
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                            .map(|d| d.as_secs())
                            .unwrap_or(0),
                        created_time: metadata.created()
                            .ok()
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                            .map(|d| d.as_secs())
                            .unwrap_or(0),
                        is_directory: metadata.is_dir(),
                        extension: path.extension()
                            .map(|e| e.to_string_lossy().to_string())
                            .unwrap_or_default(),
                        category: categorize_file(&path),
                    };

                    let mut files = files.lock().unwrap();
                    files.push(file_info);
                    
                    let count = counter.fetch_add(1, Ordering::Relaxed);
                    if count % 1000 == 0 {
                        // Progress indicator could be logged here
                    }
                }
            });

        let files = Arc::try_unwrap(files)
            .map_err(|_| "Failed to unwrap Arc")?
            .into_inner()
            .map_err(|_| "Failed to unlock Mutex")?;

        Ok(files)
    }

    /// Scan with progress callback
    pub fn scan_with_callback<P: AsRef<Path>, F>(
        &self,
        path: P,
        mut callback: F,
    ) -> Result<Vec<FileInfo>, String>
    where
        F: FnMut(u32, &str),
    {
        let path = path.as_ref();
        let files = self.scan(path)?;
        let total = files.len();
        
        for (i, file) in files.iter().enumerate() {
            let progress = ((i as f64 / total as f64) * 100.0) as u32;
            callback(progress, &file.path);
        }

        Ok(files)
    }

    /// Get directory statistics
    pub fn get_stats<P: AsRef<Path>>(&self, path: P) -> Result<DirStats, String> {
        let files = self.scan(path)?;
        
        let total_size: u64 = files.iter().map(|f| f.size).sum();
        let file_count = files.len();
        let dir_count = files.iter().filter(|f| f.is_directory).count();

        // Count by category
        let mut categories: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        for file in &files {
            *categories.entry(file.category.clone()).or_insert(0) += 1;
        }

        Ok(DirStats {
            total_files: file_count,
            total_dirs: dir_count,
            total_size,
            categories,
        })
    }
}

/// Directory statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirStats {
    pub total_files: usize,
    pub total_dirs: usize,
    pub total_size: u64,
    pub categories: std::collections::HashMap<String, usize>,
}

/// Categorize file by extension
fn categorize_file(path: &Path) -> String {
    let ext = path.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "exe" | "dll" | "msi" | "pkg" | "deb" | "rpm" | "app" | "apk" | "ipa" => "software".to_string(),
        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "svg" | "webp" | "ico" | "psd" | "ai" | "tiff" | "raw" => "image".to_string(),
        "mp4" | "avi" | "mkv" | "mov" | "wmv" | "flv" | "webm" | "m4v" | "mpg" | "mpeg" => "video".to_string(),
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "wma" | "m4a" => "audio".to_string(),
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "txt" | "md" | "rtf" | "odt" | "ods" | "odp" => "document".to_string(),
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" => "archive".to_string(),
        "js" | "ts" | "py" | "java" | "cpp" | "c" | "h" | "rs" | "go" | "rb" | "php" => "code".to_string(),
        _ => "other".to_string(),
    }
}

/// Batch file processor for efficient parallel processing
pub struct BatchProcessor {
    batch_size: usize,
}

impl BatchProcessor {
    pub fn new(batch_size: usize) -> Self {
        Self { batch_size }
    }

    /// Process files in batches
    pub fn process_batches<F, T>(&self, files: Vec<FileInfo>, processor: F) -> Vec<T>
    where
        F: Fn(&FileInfo) -> T + Send + Sync,
        T: Send,
    {
        use rayon::prelude::*;

        files
            .par_chunks(self.batch_size)
            .flat_map(|chunk| {
                chunk.iter().map(&processor).collect::<Vec<_>>()
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_scan_directory() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        fs::write(&file_path, "test content").unwrap();

        let scanner = FileScanner::new(ScanOptions::default());
        let files = scanner.scan(temp_dir.path()).unwrap();

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].extension, "txt");
        assert_eq!(files[0].category, "document");
    }

    #[test]
    fn test_categorize_file() {
        assert_eq!(categorize_file(Path::new("test.jpg")), "image");
        assert_eq!(categorize_file(Path::new("test.exe")), "software");
        assert_eq!(categorize_file(Path::new("test.pdf")), "document");
    }
}
