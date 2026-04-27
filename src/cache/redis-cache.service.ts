import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);

  private readonly redis = new Redis(
    process.env.REDIS_URL ?? 'redis://localhost:6379',
    {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    },
  );

  private hasConnected = false;

  private async ensureConnection() {
    if (this.hasConnected || this.redis.status === 'ready') {
      this.hasConnected = true;
      return;
    }

    try {
      await this.redis.connect();
      this.hasConnected = true;
    } catch (error) {
      this.logger.warn(`Redis connection failed: ${(error as Error).message}`);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    await this.ensureConnection();

    try {
      const value = await this.redis.get(key);
      if (!value) return null;
      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.warn(`Redis get failed for key "${key}": ${(error as Error).message}`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds = 120): Promise<void> {
    await this.ensureConnection();

    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(`Redis set failed for key "${key}": ${(error as Error).message}`);
    }
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    await this.ensureConnection();

    try {
      let cursor = '0';

      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          `${prefix}*`,
          'COUNT',
          '100',
        );

        if (keys.length > 0) {
          await this.redis.del(...keys);
        }

        cursor = nextCursor;
      } while (cursor !== '0');
    } catch (error) {
      this.logger.warn(`Redis delete by prefix failed for "${prefix}": ${(error as Error).message}`);
    }
  }

  async onModuleDestroy() {
    if (this.redis.status === 'ready' || this.redis.status === 'connecting') {
      await this.redis.quit();
    }
  }
}
