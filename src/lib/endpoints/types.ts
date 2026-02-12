export interface OpenAICompatibleEndpointConfig {
  model: string;
  source_model?: string;
  api_base: string;
  api_key: string;
  mode?: 'openai';
}

export interface ImportOpenAICompatiblePayload {
  reranker?: OpenAICompatibleEndpointConfig;
  embedding?: OpenAICompatibleEndpointConfig;
  completion?: OpenAICompatibleEndpointConfig;
  image_generation?: OpenAICompatibleEndpointConfig;
  video_generation?: OpenAICompatibleEndpointConfig;
}
