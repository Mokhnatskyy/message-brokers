import express from "express";
import dotenv from "dotenv";
import { connectRabbitMQ, publishEvent, closeRabbitMQ } from "./rabbitmq.js";
import {
  connectMongoDB,
  createJob,
  getJob,
  closeMongoDB,
  storeOutboxEvent,
  markOutboxPublished,
} from "./mongodb.js";
import { startOutboxPublisher } from "./outbox-publisher.js";
import {
  createEventEnvelope,
  RoutingKeys,
  generateId,
} from "../shared/types.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "api",
  });
});

// Root endpoint
app.get("/", (_req, res) => {
  res.json({
    message: "Message Brokers API",
    version: "0.0.1",
    endpoints: {
      health: "GET /health",
      createJob: "POST /jobs",
      getJob: "GET /jobs/:jobId",
    },
  });
});

// Create a new job and publish event
app.post("/jobs", async (req, res) => {
  try {
    const { title, description } = req.body;

    if (!title) {
      return res.status(400).json({ error: "title is required" });
    }

    const jobId = generateId();
    const correlationId = generateId();

    // Save job to MongoDB
    await createJob(jobId, title, description);

    // Create event envelope
    const event = createEventEnvelope(
      RoutingKeys.JOB_CREATED,
      {
        jobId,
        title,
        description: description || "",
        createdAt: new Date().toISOString(),
      },
      correlationId
    );

    // Outbox Pattern: Store event in MongoDB first (guaranteed)
    console.log(`Storing event in outbox: ${event.eventId}`);
    await storeOutboxEvent(event.eventId, RoutingKeys.JOB_CREATED, event);

    // Then publish to RabbitMQ (may fail, but event is in outbox)
    try {
      await publishEvent(RoutingKeys.JOB_CREATED, event);
      // Mark as published in outbox
      await markOutboxPublished(event.eventId);
      console.log(`Event published and marked in outbox: ${event.eventId}`);
    } catch (publishErr) {
      console.error(
        `Failed to publish event ${event.eventId}, will retry from outbox:`,
        publishErr.message
      );
      // Event stays in outbox for outbox publisher service to retry
    }

    res.status(201).json({
      jobId,
      title,
      description: description || "",
      status: "created",
      eventId: event.eventId,
      correlationId,
    });
  } catch (err) {
    console.error("Error creating job:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get job details
app.get("/jobs/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await getJob(jobId);

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json(job);
  } catch (err) {
    console.error("Error fetching job:", err);
    res.status(500).json({ error: err.message });
  }
});

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down API...");
  await closeRabbitMQ();
  await closeMongoDB();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Start server
async function start() {
  try {
    // Connect to MongoDB
    console.log("Connecting to MongoDB...");
    await connectMongoDB(process.env.MONGODB_URI);

    // Connect to RabbitMQ
    console.log("Connecting to RabbitMQ...");
    await connectRabbitMQ(process.env.RABBITMQ_URL);

    // Start outbox publisher (republishes unpublished events)
    console.log("Starting outbox publisher...");
    startOutboxPublisher(5000); // Check every 5 seconds

    app.listen(PORT, () => {
      console.log(`✓ API server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("✗ Failed to start API:", err.message);
    process.exit(1);
  }
}

start();
