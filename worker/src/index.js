import dotenv from "dotenv";
import {
  connectRabbitMQ,
  startConsuming,
  publishEvent,
  closeRabbitMQ,
} from "./rabbitmq.js";
import {
  connectMongoDB,
  getJob,
  updateJobStatus,
  recordProcessedEvent,
  isEventAlreadyProcessed,
  closeMongoDB,
} from "./mongodb.js";
import { createEventEnvelope, RoutingKeys } from "../shared/types.js";

dotenv.config();

/**
 * Worker service with reliability patterns
 * - Idempotency: track processed events to prevent duplicates
 * - Retry: failed messages go to retry queue
 * - DLQ: messages that exhaust retries go to dead-letter queue
 */

async function processJobCreated(event) {
  const { jobId, title, description } = event.payload;
  const correlationId = event.correlationId;
  const eventId = event.eventId;

  console.log(`[${eventId}] Processing job ${jobId}: "${title}"`);

  try {
    // Check idempotency: if we've already processed this event, skip it
    const alreadyProcessed = await isEventAlreadyProcessed(eventId);
    if (alreadyProcessed) {
      console.log(`[${eventId}] ⚠ Event already processed, skipping`);
      return; // Don't throw, just return successfully
    }

    // Get job details from MongoDB
    const job = await getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found in database`);
    }

    // Simulate some processing work
    console.log(`[${eventId}] ⏳ Working on job ${jobId}...`);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Simulate occasional failures for testing retry behavior
    // Uncomment the line below to test retry/DLQ logic
    // if (Math.random() < 0.3) throw new Error("Simulated processing error");

    // Record that we've processed this event (idempotency key)
    await recordProcessedEvent(eventId, "job.created");

    // Update job status to completed
    await updateJobStatus(jobId, "completed", {
      processedAt: new Date().toISOString(),
      message: `Successfully processed: ${title}`,
    });

    // Publish job.completed event
    const completedEvent = createEventEnvelope(
      RoutingKeys.JOB_COMPLETED,
      {
        jobId,
        result: {
          processedAt: new Date().toISOString(),
          message: `Successfully processed: ${title}`,
        },
        completedAt: new Date().toISOString(),
      },
      correlationId,
      event.eventId // This event was caused by the job.created event
    );

    await publishEvent(RoutingKeys.JOB_COMPLETED, completedEvent);

    console.log(`[${eventId}] ✓ Job ${jobId} completed successfully`);
  } catch (err) {
    console.error(`[${eventId}] ✗ Error processing job ${jobId}:`, err.message);

    // Update job status to failed
    try {
      await updateJobStatus(jobId, "failed", {
        error: err.message,
        failedAt: new Date().toISOString(),
      });

      // Publish job.failed event
      const failedEvent = createEventEnvelope(
        RoutingKeys.JOB_FAILED,
        {
          jobId,
          reason: err.message,
          failedAt: new Date().toISOString(),
        },
        correlationId,
        event.eventId
      );

      await publishEvent(RoutingKeys.JOB_FAILED, failedEvent);
    } catch (publishErr) {
      console.error(`[${eventId}] Failed to publish job.failed event:`, publishErr);
    }

    // Re-throw to trigger message requeue (goes to retry queue)
    throw err;
  }
}

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down worker...");
  await closeRabbitMQ();
  await closeMongoDB();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Start worker
async function main() {
  try {
    console.log("Worker service starting...");
    console.log(`RABBITMQ_URL: ${process.env.RABBITMQ_URL}`);
    console.log(`MONGODB_URI: ${process.env.MONGODB_URI}`);

    // Connect to MongoDB
    await connectMongoDB(process.env.MONGODB_URI);

    // Connect to RabbitMQ
    await connectRabbitMQ(process.env.RABBITMQ_URL);

    // Start consuming messages
    await startConsuming(processJobCreated);

    console.log("Worker ready to consume messages");
  } catch (err) {
    console.error("Worker failed:", err);
    process.exit(1);
  }
}

main();
