import type { TaskTraceEvent } from '@/lib/types/task';

export type TraceSummary = {
  status: 'running' | 'success' | 'error' | 'cancelled' | 'idle';
  cancelledOutcome?: 'stopped' | 'ended';
  stepCount: number;
  currentStep?: string;
  durationMs?: number;
};

export type TraceStep = {
  key: string;
  name: string;
  title: string;
  status: 'running' | 'success' | 'error' | 'cancelled' | 'idle';
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  events: TaskTraceEvent[];
};

export type TransportTraceKind = 'gap_fill' | 'reconcile';
export type TransportTracePhase = 'start' | 'done' | 'error';
