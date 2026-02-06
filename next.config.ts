import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Intentionally minimal config for stability and predictable builds.
  // Prevent Next.js from inferring an incorrect workspace root when multiple
  // lockfiles exist on the machine, which can break output tracing/build workers.
  outputFileTracingRoot: __dirname,
};

export default withNextIntl(nextConfig);
