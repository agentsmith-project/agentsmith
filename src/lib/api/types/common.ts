export interface PaginationParams {
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface ErrorResponse {
  error_code: string;
  message: string;
  request_id?: string;
  file_library_id?: string;
  file_library_status?: string;
  restore_preview_id?: string;
  restore_preview_status?: string;
  operation_status?: string;
  retry_after_ms?: number;
  details?: Record<string, unknown>;
}
