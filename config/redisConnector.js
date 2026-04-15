/**
 * Redis Connection Configuration
 * Shared Redis connection for the lead app (BullMQ queue, health checks).
 *
 * IMPORTANT: BullMQ requires separate Redis connections for Queue and Worker instances.
 * In PM2 cluster mode, each worker process must have its own Redis connections.
 *
 * Environment variables (see .env.*):
 *   REDIS_HOST     - Redis server hostname
 *   REDIS_PORT     - Redis server port
 *   REDIS_PASSWORD - Redis server password (optional)
 */
import Redis from 'ioredis';
import logger from '../utils/logger.js';

// PM2 instance ID — helps trace connection logs in cluster mode
const PM2_INSTANCE_ID = process.env.pm_id || process.env.NODE_APP_INSTANCE || '0';

/**
 * Build the ioredis config object from environment variables.
 * maxRetriesPerRequest: null is required by BullMQ.
 * lazyConnect: true lets us call .connect() explicitly so startup errors surface cleanly.
 */
const getRedisConfig = () => ({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT, 10),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null, // Required for BullMQ
  enableReadyCheck: false,
  retryStrategy: (times) => {
    // Exponential back-off capped at 30 seconds
    const delay = Math.min(times * 1000, 30000);
    logger.info(`[PM2:${PM2_INSTANCE_ID}] Redis retry attempt ${times}, next retry in ${delay}ms`);
    return delay;
  },
  lazyConnect: true
});

/**
 * Internal factory — attaches standard event listeners to every connection.
 * @param {string} connectionName - Label used in log messages
 * @returns {Redis} ioredis instance (not yet connected)
 */
const createRedisConnection = (connectionName = 'default') => {
  const connection = new Redis(getRedisConfig());

  connection.on('connect', () => {
    logger.info(`[PM2:${PM2_INSTANCE_ID}] Redis [${connectionName}] connected`);
  });
  connection.on('error', (err) => {
    logger.error(`[PM2:${PM2_INSTANCE_ID}] Redis [${connectionName}] error: ${err.message}`);
  });
  connection.on('close', () => {
    logger.warn(`[PM2:${PM2_INSTANCE_ID}] Redis [${connectionName}] closed`);
  });
  connection.on('reconnecting', () => {
    logger.info(`[PM2:${PM2_INSTANCE_ID}] Redis [${connectionName}] reconnecting...`);
  });

  return connection;
};

// ---------------------------------------------------------------------------
// Singleton connection — for general app use (health checks, etc.)
// NOT suitable for BullMQ Queue/Worker (they need their own dedicated connections).
// ---------------------------------------------------------------------------
let redisConnection = null;

const withTimeout = (promise, timeoutMs, message) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs))
]);

/**
 * Get (or lazily create) the singleton Redis connection.
 * Use ONLY for non-BullMQ purposes (health checks, etc.).
 */
const getRedisConnection = () => {
  if (!redisConnection) {
    redisConnection = createRedisConnection('main');
  }
  return redisConnection;
};

/**
 * Create a brand-new (non-singleton) Redis connection.
 * MUST be used for every BullMQ Queue and Worker instance — each needs its own connection.
 * @param {string} name - Connection label for log messages
 * @returns {Redis} New ioredis instance
 */
const createNewRedisConnection = (name = 'bullmq') => {
  return createRedisConnection(name);
};

/**
 * Connect the singleton Redis connection and validate with PING.
 * Call once during server startup.
 * @returns {Promise<Redis>}
 */
const initializeRedis = async () => {
  try {
    const connection = getRedisConnection();
    await connection.connect();

    const ping = await connection.ping();
    if (ping !== 'PONG') {
      throw new Error('Redis PING validation failed');
    }

    logger.info(`[PM2:${PM2_INSTANCE_ID}] Redis initialized and ready`);
    return connection;
  } catch (error) {
    logger.error(`[PM2:${PM2_INSTANCE_ID}] Failed to initialize Redis: ${error.message}`);
    throw error;
  }
};

/**
 * Gracefully close the singleton Redis connection.
 * Call during server shutdown.
 */
const closeRedisConnection = async () => {
  if (redisConnection) {
    try {
      await redisConnection.quit();
      redisConnection = null;
      logger.info(`[PM2:${PM2_INSTANCE_ID}] Redis connection closed gracefully`);
    } catch (error) {
      logger.error(`[PM2:${PM2_INSTANCE_ID}] Error closing Redis connection: ${error.message}`);
    }
  }
};

/**
 * Ping the singleton connection to verify it is healthy.
 * @returns {Promise<boolean>}
 */
const isRedisHealthy = async () => {
  try {
    if (!redisConnection) return false;

    const healthTimeoutMs = parseInt(process.env.REDIS_HEALTH_TIMEOUT_MS ?? '1500', 10);

    if (redisConnection.status !== 'ready') {
      await withTimeout(
        redisConnection.connect(),
        healthTimeoutMs,
        `Redis health connect timeout after ${healthTimeoutMs}ms`
      );
    }

    const result = await withTimeout(
      redisConnection.ping(),
      healthTimeoutMs,
      `Redis health ping timeout after ${healthTimeoutMs}ms`
    );
    return result === 'PONG';
  } catch (error) {
    logger.error(`[PM2:${PM2_INSTANCE_ID}] Redis health check failed: ${error.message}`);
    return false;
  }
};

export {
  getRedisConnection,
  createNewRedisConnection,
  initializeRedis,
  closeRedisConnection,
  isRedisHealthy
};
