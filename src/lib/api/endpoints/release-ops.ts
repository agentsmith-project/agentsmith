import type { ApiClient } from '../client';

export interface ReleaseReportListItem {
  name: string;
  generated_at: string;
  status: 'pass' | 'fail' | 'unknown';
  branch?: string;
  commit_short?: string;
  runtime_release_readiness?: 'ready' | 'blocked';
  usage_release_readiness?: 'ready' | 'blocked';
  markdown_available: boolean;
}

export interface ReleaseReportDetail {
  name: string;
  report: Record<string, unknown>;
  markdown?: string;
}

export class ReleaseOpsAPI {
  constructor(private readonly client: ApiClient) {}

  async listReports(): Promise<{ items: ReleaseReportListItem[] }> {
    return this.client.get('/internal/release-reports');
  }

  async getReport(name: string): Promise<ReleaseReportDetail> {
    return this.client.get(`/internal/release-reports/${encodeURIComponent(name)}`);
  }
}
