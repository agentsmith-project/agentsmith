'use client';
import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Upload, X, File as FileIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FileUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload: (files: File[]) => void;
  uploading?: boolean;
  uploadProgress?: Record<string, number>; // file name -> progress
  uploadErrors?: Record<string, string>; // file name -> error message
}

interface FileItem {
  file: File;
  progress?: number;
  error?: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
}

export function FileUploadDialog({
  open,
  onOpenChange,
  onUpload,
  uploading = false,
  uploadProgress = {},
  uploadErrors = {},
}: FileUploadDialogProps) {
  const [files, setFiles] = React.useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Update file status based on props
  React.useEffect(() => {
    setFiles((prev) =>
      prev.map((item) => {
        const progress = uploadProgress[item.file.name];
        const error = uploadErrors[item.file.name];
        let status = item.status;

        if (error) {
          status = 'error';
        } else if (progress !== undefined) {
          if (progress >= 100) {
            status = 'success';
          } else if (progress > 0) {
            status = 'uploading';
          }
        }

        return { ...item, progress, error, status };
      }),
    );
  }, [uploadProgress, uploadErrors]);

  const handleFileSelect = (selectedFiles: FileList | null) => {
    if (!selectedFiles) return;

    const newFiles: FileItem[] = Array.from(selectedFiles).map((file) => ({
      file,
      status: 'pending' as const,
    }));

    setFiles((prev) => [...prev, ...newFiles]);

    // Reset the file input so the same file can be re-selected after removal
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleUpload = () => {
    const filesToUpload = files
      .filter((item) => item.status === 'pending')
      .map((item) => item.file);
    if (filesToUpload.length > 0) {
      onUpload(filesToUpload);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !uploading) {
      setFiles([]);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[600px]" data-testid="files__upload-dialog">
        <DialogHeader>
          <DialogTitle>Upload Files</DialogTitle>
          <DialogDescription>
            Select files to upload or drag and drop them here
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Drop Zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={cn(
              'border-2 border-dashed rounded-md p-8 text-center transition-colors',
              isDragging
                ? 'border-primary bg-primary/5'
                : 'border-subtle bg-surface-high hover:border-primary/50',
            )}
          >
            <Upload className="mx-auto h-12 w-12 text-tertiary mb-4" />
            <p className="text-sm text-foreground mb-2">
              Drag and drop files here, or click to select
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              Select Files
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleFileSelect(e.target.files)}
            />
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {files.map((item, index) => (
                <div
                  key={`${item.file.name}-${index}`}
                  className="flex items-center gap-3 p-3 rounded-md border border-subtle bg-surface-high"
                >
                  <FileIcon className="h-4 w-4 text-tertiary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{item.file.name}</p>
                    <p className="text-xs text-tertiary">
                      {(item.file.size / 1024).toFixed(1)} KB
                    </p>
                    {item.status === 'uploading' && item.progress !== undefined && (
                      <Progress value={item.progress} className="mt-2 h-1" />
                    )}
                    {item.status === 'error' && item.error && (
                      <p className="text-xs text-error mt-1">{item.error}</p>
                    )}
                    {item.status === 'success' && (
                      <p className="text-xs text-success mt-1">Uploaded successfully</p>
                    )}
                  </div>
                  {item.status !== 'uploading' && (
                    <button
                      type="button"
                      onClick={() => handleRemoveFile(index)}
                      className="text-tertiary hover:text-foreground transition-colors"
                      disabled={uploading}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={uploading}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={files.length === 0 || uploading}>
              {uploading ? 'Uploading...' : `Upload ${files.length} file(s)`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
