import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    // Use a single fork worker to avoid intermittent OOM in large jsdom suites.
    pool: 'forks',
    maxWorkers: 1,
    execArgv: ['--max-old-space-size=6144'],
    setupFiles: ['./src/test/setup.ts'],
    env: {
      NEXT_PUBLIC_USE_MSW: 'true',
    },
    include: ['**/__tests__/**/*.{test,spec}.{js,ts,tsx}', '**/*.{test,spec}.{js,ts,tsx}'],
    exclude: [
      'node_modules/',
      'artifacts/',
      'env/',
      '.worktrees/',
      '**/.worktrees/**',
      'dist/',
      '.next/',
      'e2e/',
      '**/*.config.*',
      '**/mocks/**',
      '**/stories/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'artifacts/',
        'env/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mocks/**',
        '**/stories/**',
        'e2e/',
      ],
      thresholds: {
        statements: 40,
        branches: 35,
        functions: 40,
        lines: 45,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@mbos/api-entry-node': path.resolve(__dirname, './packages/api-entry-node/src/index.ts'),
    },
  },
});
