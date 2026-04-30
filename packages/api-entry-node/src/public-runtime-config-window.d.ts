import type { PublicRuntimeConfig } from '@/lib/public-runtime-config';

declare global {
  interface Window {
    __MBOS_PUBLIC_RUNTIME_CONFIG__?: PublicRuntimeConfig;
  }
}

export {};
