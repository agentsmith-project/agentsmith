import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Intentionally minimal config for stability and predictable builds.
  // Prevent Next.js from inferring an incorrect workspace root when multiple
  // lockfiles exist on the machine, which can break output tracing/build workers.
  outputFileTracingRoot: __dirname,
  // Allow isolated dev/test lanes to use separate build artifacts so concurrent
  // Next dev servers do not corrupt each other's vendor chunks.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Disable dev indicators for clean visual baselines.
  devIndicators: false,
  eslint: {
    // Keep default behavior unless explicitly disabled for visual builds.
    ignoreDuringBuilds: process.env.NEXT_DISABLE_ESLINT === '1',
  },
  webpack: (config) => {
    config.resolve ??= {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
