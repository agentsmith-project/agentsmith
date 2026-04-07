export interface EndpointBulkImportItemConfig {
  model: string;
  api_base: string;
  api_key: string;
  mode?: 'openai';
}

export interface EndpointBulkImportPayload {
  reranker?: EndpointBulkImportItemConfig;
  embedding?: EndpointBulkImportItemConfig;
  completion?: EndpointBulkImportItemConfig;
  image_generation?: EndpointBulkImportItemConfig;
  video_generation?: EndpointBulkImportItemConfig;
}
