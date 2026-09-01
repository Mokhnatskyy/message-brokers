import express from "express";
import dotenv from "dotenv";
import { connectRabbitMQ, publishEvent, closeRabbitMQ } from "./rabbitmq.js";
import { connectMongoDB, createJob, getJob, closeMongoDB } from "./mongodb.js";
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

    // Publish job.created event
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

    await publishEvent(RoutingKeys.JOB_CREATED, event);

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

    app.listen(PORT, () => {
      console.log(`✓ API server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("✗ Failed to start API:", err.message);
    process.exit(1);
  }
}

start();
