export type SourceInputRef = {
  kind: 'source';
  source_id: string;
  name?: string;
  ai_ready_status?: 'idle' | 'preparing' | 'ready' | 'failed' | 'cancelled';
};

export type LibraryObjectInputRef = {
  kind: 'library_object';
  library_id: string;
  key: string;
  name?: string;
  content_type?: string;
  size_bytes?: number;
};

export type UrlInputRef = {
  kind: 'url';
  url: string;
};

export type ArtifactInputRef = {
  kind: 'artifact';
  task_id: string;
  artifact_id: string;
  task_relative_path?: string;
};

export type InputRef = SourceInputRef | LibraryObjectInputRef | UrlInputRef | ArtifactInputRef;

export type ChatAttachmentInputRef = LibraryObjectInputRef;
export type ChatMessageInputRef = ChatAttachmentInputRef;
