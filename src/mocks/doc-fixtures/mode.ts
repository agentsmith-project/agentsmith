import { getPublicRuntimeConfig } from '@/lib/public-runtime-config';

export const DOC_FIXTURES_ENABLED = getPublicRuntimeConfig().docFixtures;
