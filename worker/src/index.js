import dotenv from "dotenv";

dotenv.config();

/**
 * Worker service skeleton
 * Connects to RabbitMQ and waits for messages.
 * This is the foundation for consuming job.created, job.completed, etc.
 */

async function main() {
  console.log("Worker service starting...");
  console.log(`RABBITMQ_URL: ${process.env.RABBITMQ_URL}`);
  console.log(`MONGODB_URI: ${process.env.MONGODB_URI}`);

  // TODO: Connect to RabbitMQ
  // TODO: Set up channel and assert topology
  // TODO: Register consumer handlers
  // TODO: Add graceful shutdown

  console.log("Worker ready to consume messages");

  // Keep the process alive
  await new Promise(() => {});
}

main().catch((err) => {
  console.error("Worker failed:", err);
  process.exit(1);
});
