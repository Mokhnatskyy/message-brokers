// mongosh bootstrap script for the message_brokers database.
// Run: mongosh "mongodb://admin:admin@localhost:27017/message_brokers?authSource=admin" mongodb/init-schema.js

const database = db.getSiblingDB("message_brokers");

function ensureCollection(name, validator) {
  const existing = database.getCollectionInfos({ name });
  if (existing.length === 0) {
    database.createCollection(name, {
      validator: { $jsonSchema: validator },
      validationLevel: "strict",
      validationAction: "error",
    });
  } else {
    database.runCommand({
      collMod: name,
      validator: { $jsonSchema: validator },
      validationLevel: "moderate",
      validationAction: "error",
    });
  }
}

const eventTimelineItem = {
  bsonType: "object",
  required: ["eventType", "occurredAt"],
  properties: {
    eventId: { bsonType: "string" },
    eventType: { bsonType: "string" },
    occurredAt: { bsonType: "date" },
    actor: { bsonType: "string" },
    summary: { bsonType: "string" },
  },
};

ensureCollection("jobs", {
  bsonType: "object",
  required: ["jobId", "title", "description", "status", "correlationId", "createdAt", "updatedAt", "version", "events"],
  properties: {
    jobId: { bsonType: "string", minLength: 1, maxLength: 128 },
    title: { bsonType: "string", minLength: 1, maxLength: 500 },
    description: { bsonType: "string", maxLength: 10000 },
    status: { enum: ["created", "processing", "completed", "failed", "cancelled"] },
    correlationId: { bsonType: "string", minLength: 1, maxLength: 128 },
    createdAt: { bsonType: "date" },
    updatedAt: { bsonType: "date" },
    startedAt: { bsonType: "date" },
    completedAt: { bsonType: "date" },
    failedAt: { bsonType: "date" },
    version: { bsonType: ["int", "long"], minimum: 1 },
    result: { bsonType: "object" },
    failure: {
      bsonType: "object",
      properties: {
        code: { bsonType: "string" },
        message: { bsonType: "string" },
        retryable: { bsonType: "bool" },
        eventId: { bsonType: "string" },
      },
    },
    events: { bsonType: "array", items: eventTimelineItem },
  },
});

ensureCollection("outbox", {
  bsonType: "object",
  required: ["eventId", "aggregateType", "aggregateId", "eventType", "version", "routingKey", "eventEnvelope", "status", "attemptCount", "nextAttemptAt", "createdAt"],
  properties: {
    eventId: { bsonType: "string", minLength: 1 },
    aggregateType: { bsonType: "string", enum: ["job"] },
    aggregateId: { bsonType: "string", minLength: 1 },
    eventType: { bsonType: "string", minLength: 1 },
    version: { bsonType: ["int", "long"], minimum: 1 },
    routingKey: { bsonType: "string", minLength: 1 },
    eventEnvelope: { bsonType: "object" },
    status: { enum: ["pending", "publishing", "published", "failed"] },
    attemptCount: { bsonType: ["int", "long"], minimum: 0 },
    nextAttemptAt: { bsonType: "date" },
    createdAt: { bsonType: "date" },
    publishedAt: { bsonType: ["date", "null"] },
    lastError: { bsonType: "object" },
    lease: {
      bsonType: "object",
      properties: { owner: { bsonType: "string" }, expiresAt: { bsonType: "date" } },
    },
  },
});

ensureCollection("idempotency", {
  bsonType: "object",
  required: ["eventId", "consumer", "eventType", "status", "attempts", "claimedAt", "expiresAt"],
  properties: {
    eventId: { bsonType: "string", minLength: 1 },
    consumer: { bsonType: "string", minLength: 1 },
    eventType: { bsonType: "string", minLength: 1 },
    status: { enum: ["processing", "completed", "failed"] },
    attempts: { bsonType: ["int", "long"], minimum: 1 },
    claimToken: { bsonType: "string" },
    claimedAt: { bsonType: "date" },
    completedAt: { bsonType: "date" },
    resultHash: { bsonType: "string" },
    error: { bsonType: "object" },
    expiresAt: { bsonType: "date" },
  },
});

ensureCollection("processing_history", {
  bsonType: "object",
  required: ["eventId", "consumer", "jobId", "correlationId", "attempt", "delivery", "outcome", "occurredAt", "expiresAt"],
  properties: {
    eventId: { bsonType: "string", minLength: 1 },
    consumer: { bsonType: "string", minLength: 1 },
    jobId: { bsonType: "string", minLength: 1 },
    correlationId: { bsonType: "string", minLength: 1 },
    attempt: { bsonType: ["int", "long"], minimum: 1 },
    delivery: {
      bsonType: "object",
      required: ["redelivered", "queue"],
      properties: { redelivered: { bsonType: "bool" }, queue: { bsonType: "string" } },
    },
    outcome: { enum: ["started", "succeeded", "retrying", "dead_lettered", "failed"] },
    durationMs: { bsonType: ["long", "int", "double"] },
    error: { bsonType: "object" },
    occurredAt: { bsonType: "date" },
    expiresAt: { bsonType: "date" },
  },
});

database.jobs.createIndex({ jobId: 1 }, { unique: true, name: "uq_jobs_jobId" });
database.jobs.createIndex({ status: 1, updatedAt: -1 }, { name: "jobs_status_updatedAt" });
database.jobs.createIndex({ correlationId: 1, createdAt: -1 }, { name: "jobs_correlation_createdAt" });
database.jobs.createIndex({ createdAt: -1 }, { name: "jobs_createdAt" });

database.outbox.createIndex({ eventId: 1 }, { unique: true, name: "uq_outbox_eventId" });
database.outbox.createIndex({ status: 1, nextAttemptAt: 1 }, { name: "outbox_publish_work" });
database.outbox.createIndex({ "lease.expiresAt": 1 }, { name: "outbox_expired_lease" });
// Pending records keep publishedAt: null, so this TTL index only expires published records.
database.outbox.createIndex({ publishedAt: 1 }, { expireAfterSeconds: 604800, name: "outbox_published_ttl_7d" });

database.idempotency.createIndex({ eventId: 1, consumer: 1 }, { unique: true, name: "uq_idempotency_event_consumer" });
database.idempotency.createIndex({ status: 1, claimedAt: 1 }, { name: "idempotency_processing_claimedAt" });
database.idempotency.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "idempotency_ttl" });

database.processing_history.createIndex({ eventId: 1, consumer: 1, occurredAt: -1 }, { name: "history_event_consumer" });
database.processing_history.createIndex({ jobId: 1, occurredAt: -1 }, { name: "history_job" });
database.processing_history.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "history_ttl" });

print("message_brokers schema, validators, and indexes are ready");
