'use client';
import * as React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Clock } from 'lucide-react';

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
  className?: string;
  maxDays?: number; // Default 90
}

const PRESETS: Record<TimeRangePreset, { label: string; getRange: () => TimeRange }> = {
  last_24h: {
    label: 'Last 24 hours',
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
    label: 'Last 7 days',
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
    label: 'Last 30 days',
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
    label: 'Today',
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
    label: 'This month',
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
    label: 'Custom range',
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

export function TimeRangePicker({
  value,
  onChange,
  presets = ['last_24h', 'last_7d', 'last_30d', 'custom'],
  showCustom = true,
  className,
  maxDays = 90,
}: TimeRangePickerProps) {
  const [preset, setPreset] = React.useState<TimeRangePreset | 'custom'>('last_24h');
  const [startTime, setStartTime] = React.useState(
    value.start_time ? new Date(value.start_time).toISOString().slice(0, 16) : '',
  );
  const [endTime, setEndTime] = React.useState(
    value.end_time ? new Date(value.end_time).toISOString().slice(0, 16) : '',
  );
  const [error, setError] = React.useState<string | null>(null);

  // Update local state when value prop changes
  React.useEffect(() => {
    if (value.start_time) {
      setStartTime(new Date(value.start_time).toISOString().slice(0, 16));
    }
    if (value.end_time) {
      setEndTime(new Date(value.end_time).toISOString().slice(0, 16));
    }
  }, [value.start_time, value.end_time]);

  const handlePresetChange = (newPreset: string) => {
    if (newPreset === 'custom') {
      setPreset('custom');
      return;
    }

    const presetKey = newPreset as TimeRangePreset;
    const range = PRESETS[presetKey].getRange();
    setPreset(presetKey);
    onChange(range);
    setError(null);
  };

  const handleCustomTimeChange = () => {
    if (!startTime || !endTime) {
      setError('Both start and end times are required');
      return;
    }

    const start = new Date(startTime);
    const end = new Date(endTime);
    const now = new Date();

    // Validation
    if (end < start) {
      setError('End time cannot be earlier than start time');
      return;
    }

    if (end > now) {
      setError('End time cannot be later than current time');
      return;
    }

    const daysDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff > maxDays) {
      setError(`Time range cannot exceed ${maxDays} days`);
      return;
    }

    setError(null);
    onChange({
      start_time: start.toISOString(),
      end_time: end.toISOString(),
    });
  };

  const formatDateTime = (isoString: string): string => {
    const date = new Date(isoString);
    return date.toISOString().slice(0, 16);
  };

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center gap-4">
        <Select value={preset} onValueChange={handlePresetChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {presets.map((p) => (
              <SelectItem key={p} value={p}>
                {PRESETS[p].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {preset === 'custom' && (
          <div className="flex items-center gap-4 flex-1">
            <div className="flex-1">
              <label htmlFor="start-time" className="text-xs text-tertiary mb-1 block">
                Start Time
              </label>
              <div className="relative">
                <Input
                  id="start-time"
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => {
                    setStartTime(e.target.value);
                    setTimeout(handleCustomTimeChange, 100);
                  }}
                  className="w-full"
                />
                <Clock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-tertiary pointer-events-none" />
              </div>
            </div>
            <div className="flex-1">
              <label htmlFor="end-time" className="text-xs text-tertiary mb-1 block">
                End Time
              </label>
              <div className="relative">
                <Input
                  id="end-time"
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => {
                    setEndTime(e.target.value);
                    setTimeout(handleCustomTimeChange, 100);
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

      {preset !== 'custom' && (
        <div className="text-xs text-tertiary">
          {formatDateTime(value.start_time)} → {formatDateTime(value.end_time)}
        </div>
      )}
    </div>
  );
}
