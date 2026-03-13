import type { AuditEvent } from '@/lib/api/types';

export type AuditOverviewSummary = {
  eventCount: number;
  changeCount: number;
  anomalyCount: number;
  affectedResourceCount: number;
};

export type TraceMatchStatus = 'matched' | 'unmatched' | null;

export type AuditTraceLookup = {
  ref?: string;
  incidentId?: string;
  escalationId?: string;
  runId?: string;
};

export type AuditSummaryEvent = AuditEvent;
