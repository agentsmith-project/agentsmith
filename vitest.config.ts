import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['**/__tests__/**/*.{test,spec}.{js,ts,tsx}', '**/*.{test,spec}.{js,ts,tsx}'],
    exclude: [
      'node_modules/',
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
    },
  },
});
