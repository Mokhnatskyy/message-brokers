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
    $inc: { version: 1 },
    $push: {
      events: {
        eventType:
          newStatus === "completed" ? "job.completed" : "job.failed",
        occurredAt: new Date(),
        result,
      },
    },
  };

  const result_obj = await jobs.updateOne({ jobId }, update);
  return result_obj.modifiedCount > 0;
}

/**
 * Record that an event has been processed (idempotency)
 * Prevents duplicate processing if the same event is delivered twice
 */
export async function recordProcessedEvent(eventId, eventType) {
  const idempotency = db.collection("idempotency");

  try {
    await idempotency.insertOne({
      eventId,
      consumer: "job-worker",
      eventType,
      status: "completed",
      attempts: 1,
      claimToken: eventId,
      claimedAt: new Date(),
      processedAt: new Date(),
      workerProcessed: true,
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });
    return true;
  } catch (err) {
    // Duplicate key means we've already processed this event
    if (err.code === 11000) {
      console.log(`Event ${eventId} already processed (duplicate)`);
      return false;
    }
    throw err;
  }
}

/**
 * Check if an event has already been processed
 */
export async function isEventAlreadyProcessed(eventId) {
  const idempotency = db.collection("idempotency");
  const result = await idempotency.findOne({ eventId });
  return result !== null;
}
