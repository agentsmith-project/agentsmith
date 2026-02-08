'use client';
import * as React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';

export type TimeRangePreset = 'last_24h' | 'last_7d' | 'last_30d' | 'today' | 'this_month' | 'custom';

export interface TimeRange {
  start_time: string; // ISO 8601
  end_time: string; // ISO 8601
}

export interface TimeRangePickerProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
  presets?: TimeRangePreset[];
  showCustom?: boolean;
  showResolvedRangeLabel?: boolean;
  className?: string;
  maxDays?: number; // Default 90
}

function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

const PRESET_RANGE_BUILDERS: Record<TimeRangePreset, { getRange: () => TimeRange }> = {
  last_24h: {
    getRange: () => {
      const end = new Date();
      const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
      return {
        start_time: start.toISOString(),
        end_time: end.toISOString(),
      };
    },
  },
  last_7d: {
    getRange: () => {
      const end = new Date();
      const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
      return {
        start_time: start.toISOString(),
        end_time: end.toISOString(),
      };
    },
  },
  last_30d: {
    getRange: () => {
      const end = new Date();
      const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      return {
        start_time: start.toISOString(),
        end_time: end.toISOString(),
      };
    },
  },
  today: {
    getRange: () => {
      const end = new Date();
      const start = new Date(end);
      start.setHours(0, 0, 0, 0);
      return {
        start_time: start.toISOString(),
        end_time: end.toISOString(),
      };
    },
  },
  this_month: {
    getRange: () => {
      const end = new Date();
      const start = new Date(end.getFullYear(), end.getMonth(), 1);
      start.setHours(0, 0, 0, 0);
      return {
        start_time: start.toISOString(),
        end_time: end.toISOString(),
      };
    },
  },
  custom: {
    getRange: () => {
      const end = new Date();
      const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
      return {
        start_time: start.toISOString(),
        end_time: end.toISOString(),
      };
    },
  },
};

function isWithinTolerance(actual: string, expected: string, toleranceMs: number): boolean {
  const actualTime = new Date(actual).getTime();
  const expectedTime = new Date(expected).getTime();
  return Number.isFinite(actualTime) && Number.isFinite(expectedTime) && Math.abs(actualTime - expectedTime) <= toleranceMs;
}

function detectPresetFromRange(
  range: TimeRange,
  allowedPresets: TimeRangePreset[],
  toleranceMs: number = 3 * 60 * 1000,
): TimeRangePreset | 'custom' {
  for (const preset of allowedPresets) {
    if (preset === 'custom') continue;
    const expected = PRESET_RANGE_BUILDERS[preset].getRange();
    if (
      isWithinTolerance(range.start_time, expected.start_time, toleranceMs) &&
      isWithinTolerance(range.end_time, expected.end_time, toleranceMs)
    ) {
      return preset;
    }
  }
  if (allowedPresets.includes('custom')) return 'custom';
  return allowedPresets[0] ?? 'last_24h';
}

export function TimeRangePicker({
  value,
  onChange,
  presets = ['last_24h', 'last_7d', 'last_30d', 'custom'],
  showCustom: _showCustom = true,
  showResolvedRangeLabel = true,
  className,
  maxDays = 90,
}: TimeRangePickerProps) {
  const commonT = useTranslations('common');
  const [preset, setPreset] = React.useState<TimeRangePreset | 'custom'>('last_24h');
  const [startTime, setStartTime] = React.useState(
    value.start_time ? new Date(value.start_time).toISOString().slice(0, 16) : '',
  );
  const [endTime, setEndTime] = React.useState(
    value.end_time ? new Date(value.end_time).toISOString().slice(0, 16) : '',
  );
  const [error, setError] = React.useState<string | null>(null);
  const availablePresets = React.useMemo(
    () => (_showCustom ? presets : presets.filter((preset) => preset !== 'custom')),
    [presets, _showCustom],
  );

  // Update local state when value prop changes
  React.useEffect(() => {
    if (value.start_time) {
      setStartTime(new Date(value.start_time).toISOString().slice(0, 16));
    }
    if (value.end_time) {
      setEndTime(new Date(value.end_time).toISOString().slice(0, 16));
    }
    setPreset(detectPresetFromRange(value, availablePresets));
  }, [value, availablePresets]);

  const handlePresetChange = (newPreset: string) => {
    if (newPreset === 'custom') {
      setPreset('custom');
      return;
    }

    const presetKey = newPreset as TimeRangePreset;
    const range = PRESET_RANGE_BUILDERS[presetKey].getRange();
    setPreset(presetKey);
    onChange(range);
    setError(null);
  };

  /**
   * Validate and submit a custom time range.
   * Accepts explicit values to avoid stale-closure issues with React state.
   */
  const handleCustomTimeChange = React.useCallback(
    (currentStart: string, currentEnd: string) => {
      if (!currentStart || !currentEnd) {
        setError(commonT('both_start_end_required'));
        return;
      }

      const start = new Date(currentStart);
      const end = new Date(currentEnd);
      const now = new Date();

      if (end < start) {
        setError(commonT('end_time_before_start'));
        return;
      }

      if (end > now) {
        setError(commonT('end_time_after_now'));
        return;
      }

      const daysDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff > maxDays) {
        setError(commonT('max_days_exceeded', { maxDays: maxDays.toString() }));
        return;
      }

      setError(null);
      onChange({
        start_time: start.toISOString(),
        end_time: end.toISOString(),
      });
    },
    [commonT, onChange, maxDays],
  );

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center gap-3">
        <Select value={preset} onValueChange={handlePresetChange}>
          <SelectTrigger className="h-10 w-full min-w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {availablePresets.map((p) => (
              <SelectItem key={p} value={p}>
                {commonT(`time_preset_${p}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {preset === 'custom' && (
          <div className="flex flex-col gap-3 md:flex-row md:items-center flex-1">
            <div className="flex-1">
              <label htmlFor="start-time" className="text-xs text-tertiary mb-1 block">
                {commonT('start_time')}
              </label>
              <div className="relative">
                <Input
                  id="start-time"
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => {
                    const newStart = e.target.value;
                    setStartTime(newStart);
                    handleCustomTimeChange(newStart, endTime);
                  }}
                  className="w-full"
                />
                <Clock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-tertiary pointer-events-none" />
              </div>
            </div>
            <div className="flex-1">
              <label htmlFor="end-time" className="text-xs text-tertiary mb-1 block">
                {commonT('end_time')}
              </label>
              <div className="relative">
                <Input
                  id="end-time"
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => {
                    const newEnd = e.target.value;
                    setEndTime(newEnd);
                    handleCustomTimeChange(startTime, newEnd);
                  }}
                  className="w-full"
                />
                <Clock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-tertiary pointer-events-none" />
              </div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="text-sm text-error flex items-center gap-2">
          <span>{error}</span>
        </div>
      )}

      {preset !== 'custom' && showResolvedRangeLabel && (
        <div className="text-xs text-tertiary">
          {formatDateTime(value.start_time)} → {formatDateTime(value.end_time)}
        </div>
      )}
    </div>
  );
}
