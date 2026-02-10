export function parsePagination(
  searchParams: URLSearchParams,
  defaults: { page: number; pageSize: number; maxPageSize: number },
): { page: number; pageSize: number; offset: number } {
  const pageRaw = Number(searchParams.get('page') ?? defaults.page);
  const pageSizeRaw = Number(searchParams.get('page_size') ?? defaults.pageSize);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : defaults.page;
  const pageSizeCandidate = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0
    ? Math.floor(pageSizeRaw)
    : defaults.pageSize;
  const pageSize = Math.min(defaults.maxPageSize, pageSizeCandidate);
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}
