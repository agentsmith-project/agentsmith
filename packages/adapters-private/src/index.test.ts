import { describe, expect, it } from 'vitest';
import {
  InMemoryCache,
  InMemoryJsonDocStore,
  InMemoryObjectStore,
  InMemoryProjectRepo,
  JsonDocFileLibraryCatalogRepo,
  MinioObjectStore,
  MongoJsonDocStore,
  PostgresProjectRepo,
  RedisCache,
  SimpleIdGenerator,
  SystemClock,
  createProjectRepoFactoryResult,
} from './index.js';

describe('adapters-private public exports', () => {
  it('exposes the deployment adapters consumed by downstream packages', () => {
    expect(InMemoryCache).toBeTypeOf('function');
    expect(InMemoryJsonDocStore).toBeTypeOf('function');
    expect(InMemoryObjectStore).toBeTypeOf('function');
    expect(InMemoryProjectRepo).toBeTypeOf('function');
    expect(JsonDocFileLibraryCatalogRepo).toBeTypeOf('function');
    expect(MinioObjectStore).toBeTypeOf('function');
    expect(MongoJsonDocStore).toBeTypeOf('function');
    expect(PostgresProjectRepo).toBeTypeOf('function');
    expect(RedisCache).toBeTypeOf('function');
    expect(SimpleIdGenerator).toBeTypeOf('function');
    expect(SystemClock).toBeTypeOf('function');
    expect(createProjectRepoFactoryResult).toBeTypeOf('function');
  });
});
