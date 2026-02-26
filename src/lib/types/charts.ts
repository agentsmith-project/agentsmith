/**
 * Shared Chart Type Definitions
 *
 * Common types for chart components used in Epic C1 (Cost Dashboard)
 * and potentially other features.
 *
 * These types align with Recharts library conventions.
 */

// ============================================================================
// Chart Data Types
// ============================================================================

/**
 * Generic data point for charts
 */
export interface ChartDataPoint {
  [key: string]: string | number | undefined;
}

/**
 * Time series data point
 */
export interface TimeSeriesDataPoint extends ChartDataPoint {
  timestamp: string; // ISO 8601 or formatted label
  value: number;
  label?: string; // Display label
}

/**
 * Category data point (for bar/pie charts)
 */
export interface CategoryDataPoint extends ChartDataPoint {
  category: string;
  value: number;
  color?: string;
}

/**
 * Multi-series data point
 */
export interface MultiSeriesDataPoint extends ChartDataPoint {
  series: string; // Series name
  value: number;
}

// ============================================================================
// Chart Configuration Types
// ============================================================================

/**
 * Chart type options
 */
export type ChartType = 'line' | 'bar' | 'area' | 'pie' | 'donut' | 'stacked';

/**
 * Chart orientation (for bar charts)
 */
export type ChartOrientation = 'horizontal' | 'vertical';

/**
 * Axis type
 */
export type AxisType = 'category' | 'number' | 'time' | 'log';

/**
 * Tick position for axis
 */
export type TickPosition = 'inside' | 'outside' | 'cross';

/**
 * Legend position
 */
export type LegendPosition = 'top' | 'right' | 'bottom' | 'left';

/**
 * Tooltip trigger type
 */
export type TooltipTrigger = 'hover' | 'click' | 'none';

// ============================================================================
// Chart Style Types
// ============================================================================

/**
 * Chart color scheme (uses design system tokens)
 */
export type ChartColorScheme =
  | 'primary'    // Uses --accent (blue)
  | 'success'    // Uses --success (green)
  | 'error'      // Uses --error (red)
  | 'warning'    // Uses warning color (yellow/orange)
  | 'multi';     // Multiple colors for different series

/**
 * Chart line style
 */
export interface ChartLineStyle {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string; // For dashed lines
  fill?: string;
  fillOpacity?: number;
}

/**
 * Chart margin
 */
export interface ChartMargin {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/**
 * Grid configuration
 */
export interface ChartGridConfig {
  horizontal?: boolean;
  vertical?: boolean;
  stroke?: string;
  strokeDasharray?: string;
}

// ============================================================================
// Chart Component Props Types
// ============================================================================

/**
 * Base chart configuration
 */
export interface ChartConfig {
  type: ChartType;
  width?: number | string;
  height?: number | string;
  margin?: ChartMargin;
  responsive?: boolean;
  animation?: boolean;
}

/**
 * Axis configuration
 */
export interface ChartAxisConfig {
  type?: AxisType;
  dataKey?: string;
  label?: string;
  tick?: {
    count?: number;
    interval?: number | 'preserveStart' | 'preserveEnd' | 'preserveStartEnd';
    formatter?: (value: unknown) => string;
  };
  domain?: [number | 'auto', number | 'auto'];
}

/**
 * Tooltip configuration
 */
export interface ChartTooltipConfig {
  trigger?: TooltipTrigger;
  formatter?: (value: number, name: string, props: unknown) => [string, string];
  contentStyle?: Record<string, string>;
  labelStyle?: Record<string, string>;
}

/**
 * Legend configuration
 */
export interface ChartLegendConfig {
  position?: LegendPosition;
  align?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  formatter?: (value: string, entry: unknown) => React.ReactNode;
}

// ============================================================================
// Specific Chart Types
// ============================================================================

/**
 * Line chart configuration
 */
export interface LineChartConfig extends ChartConfig {
  type: 'line' | 'area';
  dataKey: string;
  xAxis?: ChartAxisConfig;
  yAxis?: ChartAxisConfig;
  grid?: ChartGridConfig;
  tooltip?: ChartTooltipConfig;
  legend?: ChartLegendConfig;
  lineStyle?: ChartLineStyle;
  showDots?: boolean;
  showArea?: boolean; // For area charts
}

/**
 * Bar chart configuration
 */
export interface BarChartConfig extends ChartConfig {
  type: 'bar' | 'stacked';
  dataKey: string;
  categoryKey: string;
  orientation?: ChartOrientation;
  xAxis?: ChartAxisConfig;
  yAxis?: ChartAxisConfig;
  grid?: ChartGridConfig;
  tooltip?: ChartTooltipConfig;
  legend?: ChartLegendConfig;
  barStyle?: {
    fill?: string;
    fillOpacity?: number;
    radius?: number | [number, number, number, number];
  };
}

/**
 * Pie/Donut chart configuration
 */
export interface PieChartConfig extends ChartConfig {
  type: 'pie' | 'donut';
  dataKey: string;
  nameKey: string;
  tooltip?: ChartTooltipConfig;
  legend?: ChartLegendConfig;
  innerRadius?: number; // For donut charts
  outerRadius?: number;
  paddingAngle?: number;
}

// ============================================================================
// Chart Event Types
// ============================================================================

/**
 * Chart click event handler
 */
export type ChartClickHandler = (data: ChartDataPoint, event: React.MouseEvent) => void;

/**
 * Chart hover event handler
 */
export type ChartHoverHandler = (data: ChartDataPoint, event: React.MouseEvent) => void;

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Formatted value for display
 */
export interface FormattedValue {
  raw: number;
  formatted: string;
  unit?: string;
}

/**
 * Value formatter function type
 */
export type ValueFormatter = (value: number) => FormattedValue;

/**
 * Common value formatters
 */
export const ValueFormatters = {
  number: (decimals = 0): ValueFormatter => (value: number) => ({
    raw: value,
    formatted: value.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }),
  }),

  percentage: (decimals = 1): ValueFormatter => (value: number) => ({
    raw: value,
    formatted: `${value.toFixed(decimals)}%`,
    unit: '%',
  }),

  currency: (currency = 'USD'): ValueFormatter => (value: number) => ({
    raw: value,
    formatted: value.toLocaleString(undefined, {
      style: 'currency',
      currency,
    }),
    unit: currency,
  }),

  bytes: (): ValueFormatter => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    return (value: number) => {
      let unitIndex = 0;
      let scaledValue = value;
      while (scaledValue >= 1024 && unitIndex < units.length - 1) {
        scaledValue /= 1024;
        unitIndex++;
      }
      return {
        raw: value,
        formatted: `${scaledValue.toFixed(1)} ${units[unitIndex]}`,
        unit: units[unitIndex],
      };
    };
  },

  compact: (): ValueFormatter => {
    const units = ['', 'K', 'M', 'B', 'T'];
    return (value: number) => {
      let unitIndex = 0;
      let scaledValue = value;
      while (Math.abs(scaledValue) >= 1000 && unitIndex < units.length - 1) {
        scaledValue /= 1000;
        unitIndex++;
      }
      return {
        raw: value,
        formatted: `${scaledValue.toFixed(scaledValue < 10 ? 1 : 0)}${units[unitIndex]}`,
        unit: units[unitIndex],
      };
    };
  },
} as const;

// ============================================================================
// React Component Import Types
// ============================================================================

/**
 * Recharts component types (for type safety with Recharts library)
 * These are simplified versions - actual Recharts types should be imported
 * from the 'recharts' package when used.
 */
export interface RechartsCartesianProps {
  width?: number;
  height?: number;
  data?: ChartDataPoint[];
  margin?: ChartMargin;
  children?: React.ReactNode;
}

export interface RechartsAreaProps {
  type?: 'linear' | 'monotone' | 'step' | 'stepBefore' | 'stepAfter';
  dataKey: string;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  fillOpacity?: number;
  isAnimationActive?: boolean;
}

export interface RechartsBarProps {
  dataKey: string;
  fill?: string;
  fillOpacity?: number;
  isAnimationActive?: boolean;
}

export interface RechartsLineProps {
  type?: 'linear' | 'monotone' | 'step' | 'stepBefore' | 'stepAfter';
  dataKey: string;
  stroke?: string;
  strokeWidth?: number;
  dot?: boolean | object;
  isAnimationActive?: boolean;
}

export interface RechartsXAxisProps {
  dataKey?: string;
  type?: AxisType;
  domain?: [number | 'auto', number | 'auto'];
  tick?: { count?: number; interval?: number | 'preserveStart' | 'preserveEnd' };
  tickFormatter?: (value: unknown) => string;
}

export interface RechartsYAxisProps {
  type?: AxisType;
  domain?: [number | 'auto', number | 'auto'];
  tickFormatter?: (value: unknown) => string;
}

export interface RechartsTooltipProps {
  trigger?: TooltipTrigger;
  formatter?: (value: number, name: string) => [string, string];
  contentStyle?: Record<string, string>;
}

export interface RechartsLegendProps {
  position?: LegendPosition;
  align?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
}
