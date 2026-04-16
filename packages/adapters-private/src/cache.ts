import type { CachePort } from '@mbos/ports';
import { Redis as RedisClient } from 'ioredis';

export interface RedisCacheOptions {
  url: string;
}

export class RedisCache implements CachePort {
  private readonly client: RedisClient;

  constructor(options: RedisCacheOptions) {
    this.client = new RedisClient(options.url, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, value, 'EX', ttlSeconds);
      return;
    }

    await this.client.set(key, value);
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const next = await this.client.incr(key);
    if (ttlSeconds && ttlSeconds > 0 && next === 1) {
      await this.client.expire(key, ttlSeconds);
    }
    return next;
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async compareAndSet(
    key: string,
    expectedValue: string | null,
    nextValue: string | null,
    ttlSeconds?: number,
  ): Promise<boolean> {
    await this.client.watch(key);
    const current = await this.client.get(key);
    if (current !== expectedValue) {
      await this.client.unwatch();
      return false;
    }
    const tx = this.client.multi();
    if (nextValue === null) {
      tx.del(key);
    } else if (ttlSeconds && ttlSeconds > 0) {
      tx.set(key, nextValue, 'EX', ttlSeconds);
    } else {
      tx.set(key, nextValue);
    }
    const result = await tx.exec();
    return result !== null;
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

export class InMemoryCache implements CachePort {
  private readonly store = new Map<string, { value: string; expiresAt?: number }>();

  private read(key: string): string | null {
    const record = this.store.get(key);
    if (!record) return null;
    if (typeof record.expiresAt === 'number' && record.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return record.value;
  }

  async get(key: string): Promise<string | null> {
    return this.read(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : undefined,
    });
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const current = Number.parseInt(this.read(key) ?? '0', 10);
    const next = (Number.isFinite(current) ? current : 0) + 1;
    this.store.set(key, {
      value: String(next),
      expiresAt: ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : undefined,
    });
    return next;
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async compareAndSet(
    key: string,
    expectedValue: string | null,
    nextValue: string | null,
    ttlSeconds?: number,
  ): Promise<boolean> {
    if (this.read(key) !== expectedValue) return false;
    if (nextValue === null) {
      this.store.delete(key);
      return true;
    }
    this.store.set(key, {
      value: nextValue,
      expiresAt: ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : undefined,
    });
    return true;
  }
}
