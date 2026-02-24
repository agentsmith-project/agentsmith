export type LibraryObjectLikeRef = {
  library_id: string;
  key: string;
};

export type UrlLikeRef = {
  url: string;
  imported_library_id?: string;
  imported_key?: string;
};

export type UrlImportedObjectLike = {
  imported_library_id?: string;
  imported_key?: string;
};

export type ArtifactLikeRef = {
  task_id: string;
  artifact_id: string;
};

export function libraryObjectRefKey(input: LibraryObjectLikeRef): string {
  return `${input.library_id}:${input.key}`;
}

export function urlRefKey(input: Pick<UrlLikeRef, 'url'>): string {
  return `url:${input.url}`;
}

export function artifactRefKey(input: ArtifactLikeRef): string {
  return `${input.task_id}:${input.artifact_id}`;
}

export function getImportedLibraryObjectRef(input: UrlImportedObjectLike): LibraryObjectLikeRef | null {
  if (
    typeof input.imported_library_id === 'string' &&
    input.imported_library_id.length > 0 &&
    typeof input.imported_key === 'string' &&
    input.imported_key.length > 0
  ) {
    return { library_id: input.imported_library_id, key: input.imported_key };
  }
  return null;
}

export function appendUniqueByKey<T>(args: {
  items: T[];
  seen: Set<string>;
  key: string;
  value: T;
}): boolean {
  if (args.seen.has(args.key)) return false;
  args.seen.add(args.key);
  args.items.push(args.value);
  return true;
}
