/**
 * Queue Manager — BullMQ
 * Shared queue infrastructure for the lead app.
 *
 * Key points:
 *  - Every BullMQ Queue and Worker needs its own dedicated Redis connection.
 *    This is critical in PM2 cluster mode to avoid connection conflicts between processes.
 *  - Workers are created once on startup, not per-request.
 *  - All registered queues/workers are tracked for graceful shutdown.
 */
import { Queue, Worker } from 'bullmq';
import { createNewRedisConnection } from './redisConnector.js';
import logger from '../utils/logger.js';

// PM2 instance ID — distinguishes log lines from different cluster workers
const PM2_INSTANCE_ID = process.env.pm_id || process.env.NODE_APP_INSTANCE || '0';

// Registry maps — keyed by queue name (queues/connections) or workerKey (workers)
const registeredQueues = new Map();
const registeredWorkers = new Map();
const queueConnections = new Map();
const workerConnections = new Map();

// ---------------------------------------------------------------------------
// Default job options applied to every queue unless overridden
// ---------------------------------------------------------------------------
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000
  },
  removeOnComplete: {
    age: 3600,   // keep completed jobs for 1 hour
    count: 1000  // hard cap: keep last 1 000 completed jobs
  },
  removeOnFail: {
    age: 86400   // keep failed jobs for 24 hours
  }
};

// ---------------------------------------------------------------------------
// Default worker options applied unless overridden by the caller
// ---------------------------------------------------------------------------
const DEFAULT_WORKER_OPTIONS = {
  concurrency: 5,
  limiter: {
    max: 50,
    duration: 1000 // 50 jobs/second global worker limiter
  }
};

// ---------------------------------------------------------------------------
// Queue factory
// ---------------------------------------------------------------------------

/**
 * Get (or lazily create) a named BullMQ Queue.
 * Each queue gets its own dedicated Redis connection (required for PM2 cluster mode).
 *
 * @param {string} queueName
 * @param {Object} [options]          - Optional overrides
 * @param {Object} [options.jobOptions] - Merged into defaultJobOptions
 * @returns {Queue}
 */
const getQueue = (queueName, options = {}) => {
  if (!queueName) throw new Error('Queue name is required');

  if (registeredQueues.has(queueName)) {
    return registeredQueues.get(queueName);
  }

  const connection = createNewRedisConnection(`queue-${queueName}-pm2-${PM2_INSTANCE_ID}`);
  queueConnections.set(queueName, connection);

  const queue = new Queue(queueName, {
    connection,
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      ...options.jobOptions
    }
  });

  queue.on('error', (err) => {
    logger.error(`[PM2:${PM2_INSTANCE_ID}] Queue [${queueName}] error: ${err.message}`);
  });

  registeredQueues.set(queueName, queue);
  logger.info(`[PM2:${PM2_INSTANCE_ID}] Queue [${queueName}] initialized`);

  return queue;
};

// ---------------------------------------------------------------------------
// Job producer
// ---------------------------------------------------------------------------

/**
 * Add a job to the named queue.
 *
 * @param {string} queueName
 * @param {string} jobName   - Logical job type / event type
 * @param {Object} jobData   - Payload passed to the processor
 * @param {Object} [options] - BullMQ job options (jobId, priority, delay, …)
 * @returns {Promise<Job>}
 */
const addJob = async (queueName, jobName, jobData, options = {}) => {
  const queue = getQueue(queueName);
  const jobId = options.jobId || `${queueName}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const job = await queue.add(jobName, jobData, { jobId, ...options });

  logger.info(`[PM2:${PM2_INSTANCE_ID}] Job [${job.id}] added to queue [${queueName}]`);
  return job;
};

// ---------------------------------------------------------------------------
// Worker factory
// ---------------------------------------------------------------------------

/**
 * Create a BullMQ Worker for the given queue.
 * In PM2 cluster mode each process creates its own Worker instance —
 * BullMQ uses Redis locks to ensure a job is processed by exactly one worker.
 *
 * @param {string}   queueName
 * @param {Function} processor  - async (job) => result
 * @param {Object}   [options]  - Merged into DEFAULT_WORKER_OPTIONS
 * @returns {Worker}
 */
const createWorker = (queueName, processor, options = {}) => {
  if (!queueName) throw new Error('Queue name is required');
  if (typeof processor !== 'function') throw new Error('Processor function is required');

  // One worker per PM2 instance per queue
  const workerKey = `${queueName}-pm2-${PM2_INSTANCE_ID}`;

  if (registeredWorkers.has(workerKey)) {
    logger.warn(`[PM2:${PM2_INSTANCE_ID}] Worker [${queueName}] already exists in this process — reusing`);
    return registeredWorkers.get(workerKey);
  }

  // MUST be a separate connection from the Queue connection
  const connection = createNewRedisConnection(`worker-${queueName}-pm2-${PM2_INSTANCE_ID}`);
  workerConnections.set(workerKey, connection);

  const worker = new Worker(
    queueName,
    async (job) => {
      logger.info(`[PM2:${PM2_INSTANCE_ID}] Processing job [${job.id}] from [${queueName}]`);
      try {
        const result = await processor(job);
        logger.info(`[PM2:${PM2_INSTANCE_ID}] Job [${job.id}] completed`);
        return result;
      } catch (error) {
        logger.error(`[PM2:${PM2_INSTANCE_ID}] Job [${job.id}] failed: ${error.message}`);
        throw error;
      }
    },
    {
      connection,
      ...DEFAULT_WORKER_OPTIONS,
      ...options
    }
  );

  worker.on('completed', (job) => {
    logger.info(`[PM2:${PM2_INSTANCE_ID}] [${queueName}] Job [${job.id}] completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`[PM2:${PM2_INSTANCE_ID}] [${queueName}] Job [${job?.id}] failed: ${err.message}`);
  });

  worker.on('error', (err) => {
    logger.error(`[PM2:${PM2_INSTANCE_ID}] [${queueName}] worker error: ${err.message}`);
  });

  worker.on('stalled', (jobId) => {
    logger.warn(`[PM2:${PM2_INSTANCE_ID}] [${queueName}] Job [${jobId}] stalled — will be reprocessed`);
  });

  registeredWorkers.set(workerKey, worker);
  logger.info(`[PM2:${PM2_INSTANCE_ID}] Worker [${queueName}] started | concurrency=${options.concurrency ?? DEFAULT_WORKER_OPTIONS.concurrency}`);

  return worker;
};

// ---------------------------------------------------------------------------
// Stats + registry helpers
// ---------------------------------------------------------------------------

/**
 * Return waiting / active / completed / failed / delayed counts for a queue.
 * @param {string} queueName
 * @returns {Promise<Object>}
 */
const getQueueStats = async (queueName) => {
  const queue = getQueue(queueName);

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount()
  ]);

  return {
    queueName,
    pm2Instance: PM2_INSTANCE_ID,
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + delayed
  };
};

/**
 * Return an array of all currently registered queue names.
 * @returns {string[]}
 */
const getRegisteredQueues = () => Array.from(registeredQueues.keys());

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

/**
 * Shut down all workers, then their Redis connections, then all queues, then
 * their Redis connections. Safe to call on SIGTERM / SIGINT.
 */
const shutdownAll = async () => {
  logger.info(`[PM2:${PM2_INSTANCE_ID}] Shutting down all queues and workers...`);

  // 1. Close workers first (drain in-flight jobs)
  for (const [key, worker] of registeredWorkers) {
    try {
      await worker.close();
      logger.info(`[PM2:${PM2_INSTANCE_ID}] Worker [${key}] closed`);
    } catch (err) {
      logger.error(`[PM2:${PM2_INSTANCE_ID}] Error closing worker [${key}]: ${err.message}`);
    }
  }
  registeredWorkers.clear();

  // 2. Close worker Redis connections
  for (const [key, conn] of workerConnections) {
    try {
      await conn.quit();
    } catch (err) {
      logger.error(`[PM2:${PM2_INSTANCE_ID}] Error closing worker connection [${key}]: ${err.message}`);
    }
  }
  workerConnections.clear();

  // 3. Close queues
  for (const [name, queue] of registeredQueues) {
    try {
      await queue.close();
      logger.info(`[PM2:${PM2_INSTANCE_ID}] Queue [${name}] closed`);
    } catch (err) {
      logger.error(`[PM2:${PM2_INSTANCE_ID}] Error closing queue [${name}]: ${err.message}`);
    }
  }
  registeredQueues.clear();

  // 4. Close queue Redis connections
  for (const [key, conn] of queueConnections) {
    try {
      await conn.quit();
    } catch (err) {
      logger.error(`[PM2:${PM2_INSTANCE_ID}] Error closing queue connection [${key}]: ${err.message}`);
    }
  }
  queueConnections.clear();

  logger.info(`[PM2:${PM2_INSTANCE_ID}] All queues and workers shutdown complete`);
};

export {
  getQueue,
  addJob,
  createWorker,
  getQueueStats,
  getRegisteredQueues,
  shutdownAll,
  DEFAULT_JOB_OPTIONS,
  DEFAULT_WORKER_OPTIONS
};
