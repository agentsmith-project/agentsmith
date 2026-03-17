import type { ClockPort, IdGeneratorPort } from '@mbos/ports';

export class SystemClock implements ClockPort {
  nowIso(): string {
    return new Date().toISOString();
  }
}

export class SimpleIdGenerator implements IdGeneratorPort {
  nextProjectId(): string {
    return `proj_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  }
}
