import { MongoClient } from "mongodb";

let client = null;
let db = null;

/**
 * Connect to MongoDB
 */
export async function connectMongoDB(uri) {
  try {
    client = new MongoClient(uri);
    await client.connect();

    db = client.db("message_brokers");

    // Create indexes for jobs collection
    const jobs = db.collection("jobs");
    await jobs.createIndex({ jobId: 1 }, { unique: true });
    await jobs.createIndex({ status: 1 });
    await jobs.createIndex({ createdAt: 1 });

    console.log("MongoDB connected");
    return db;
  } catch (err) {
    console.error("Failed to connect to MongoDB:", err);
    throw err;
  }
}

/**
 * Get MongoDB database instance
 */
export function getDb() {
  if (!db) {
    throw new Error("MongoDB not initialized");
  }
  return db;
}

/**
 * Close MongoDB connection
 */
export async function closeMongoDB() {
  if (client) {
    await client.close();
    console.log("MongoDB connection closed");
  }
}

/**
 * Create a new job document
 */
export async function createJob(jobId, title, description) {
  const jobs = db.collection("jobs");

  const job = {
    jobId,
    title,
    description: description || "",
    status: "created",
    createdAt: new Date(),
    updatedAt: new Date(),
    events: [
      {
        eventType: "job.created",
        timestamp: new Date(),
      },
    ],
  };

  await jobs.insertOne(job);
  return job;
}

/**
 * Get job by ID
 */
export async function getJob(jobId) {
  const jobs = db.collection("jobs");
  return jobs.findOne({ jobId });
}

/**
 * Update job status
 */
export async function updateJobStatus(jobId, newStatus, result = null) {
  const jobs = db.collection("jobs");

  const update = {
    $set: { status: newStatus, updatedAt: new Date() },
    $push: {
      events: {
        eventType:
          newStatus === "completed" ? "job.completed" : "job.failed",
        timestamp: new Date(),
        result,
      },
    },
  };

  const result_obj = await jobs.updateOne({ jobId }, update);
  return result_obj.modifiedCount > 0;
}

/**
 * Track an idempotency key (event that has been processed)
 * Prevents duplicate processing of the same event
 */
export async function recordIdempotencyKey(eventId, eventType) {
  const idempotency = db.collection("idempotency");

  try {
    await idempotency.insertOne({
      eventId,
      eventType,
      processedAt: new Date(),
    });
    return true;
  } catch (err) {
    // Duplicate key means we've already processed this event
    if (err.code === 11000) {
      return false;
    }
    throw err;
  }
}

/**
 * Check if an event has been processed before
 */
export async function isEventProcessed(eventId) {
  const idempotency = db.collection("idempotency");
  const result = await idempotency.findOne({ eventId });
  return result !== null;
}

/**
 * Outbox Pattern: Store event for reliable publishing
 * Events are persisted before publishing to ensure delivery
 */
export async function storeOutboxEvent(eventId, routingKey, eventEnvelope) {
  const outbox = db.collection("outbox");

  try {
    await outbox.insertOne({
      eventId,
      routingKey,
      eventEnvelope,
      published: false,
      createdAt: new Date(),
      publishedAt: null,
    });
    return true;
  } catch (err) {
    if (err.code === 11000) {
      console.log(`Outbox event ${eventId} already exists`);
      return false;
    }
    throw err;
  }
}

/**
 * Mark outbox event as published
 */
export async function markOutboxPublished(eventId) {
  const outbox = db.collection("outbox");
  const result = await outbox.updateOne(
    { eventId },
    {
      $set: {
        published: true,
        publishedAt: new Date(),
      },
    }
  );
  return result.modifiedCount > 0;
}

/**
 * Get unpublished outbox events
 */
export async function getUnpublishedOutboxEvents() {
  const outbox = db.collection("outbox");
  return outbox.find({ published: false }).toArray();
}

/**
 * Clean up old published outbox events (older than 24 hours)
 */
export async function cleanupPublishedOutbox() {
  const outbox = db.collection("outbox");
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await outbox.deleteMany({
    published: true,
    publishedAt: { $lt: oneDayAgo },
  });
  return result.deletedCount;
}
