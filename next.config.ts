import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';
import path from 'path';

const withNextIntl = createNextIntlPlugin('./i18n.ts');

const nextConfig: NextConfig = {
  // Intentionally minimal config for stability and predictable builds.
  // Prevent Next.js from inferring an incorrect workspace root when multiple
  // lockfiles exist on the machine, which can break output tracing/build workers.
  outputFileTracingRoot: path.join(__dirname),
};

export default withNextIntl(nextConfig);
