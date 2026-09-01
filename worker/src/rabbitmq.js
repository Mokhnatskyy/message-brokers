import amqp from "amqplib";

const EXCHANGE_NAME = "job-events";
const QUEUE_NAME = "job.created";
const RETRY_EXCHANGE = "job-events-retry";
const RETRY_QUEUE = "job.created.retry";
const DLQ_EXCHANGE = "job-events-dlq";
const DLQ_QUEUE = "job.created.dlq";
const RETRY_TTL = 5000; // 5 seconds before retry
const MAX_RETRIES = 3;
const QUEUE_OPTIONS = { durable: true };

let connection = null;
let channel = null;

/**
 * Connect to RabbitMQ and set up consumer queue with retry and DLQ
 */
export async function connectRabbitMQ(url) {
  try {
    connection = await amqp.connect(url);

    connection.on("error", (err) => {
      console.error("RabbitMQ connection error:", err);
    });

    channel = await connection.createChannel();

    // Declare main topic exchange
    await channel.assertExchange(EXCHANGE_NAME, "topic", { durable: true });

    // Declare DLQ (dead-letter queue for failed messages)
    await channel.assertExchange(DLQ_EXCHANGE, "topic", { durable: true });
    await channel.assertQueue(DLQ_QUEUE, {
      durable: true,
      arguments: {
        "x-message-ttl": 86400000, // Keep DLQ messages for 24 hours
      },
    });
    await channel.bindQueue(DLQ_QUEUE, DLQ_EXCHANGE, "job.*");

    // Declare retry exchange and queue with TTL
    await channel.assertExchange(RETRY_EXCHANGE, "topic", { durable: true });
    await channel.assertQueue(RETRY_QUEUE, {
      durable: true,
      arguments: {
        "x-message-ttl": RETRY_TTL, // Messages expire after TTL
        "x-dead-letter-exchange": DLQ_EXCHANGE, // Send to DLQ after TTL
        "x-dead-letter-routing-key": "job.failed",
      },
    });
    await channel.bindQueue(RETRY_QUEUE, RETRY_EXCHANGE, "job.created");

    // Declare main queue with DLQ
    await channel.assertQueue(QUEUE_NAME, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": RETRY_EXCHANGE, // Failed messages go to retry
        "x-dead-letter-routing-key": "job.created",
      },
    });
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, "job.created");

    console.log("RabbitMQ connected with retry and DLQ topology ready");
    return channel;
  } catch (err) {
    console.error("Failed to connect to RabbitMQ:", err);
    throw err;
  }
}

/**
 * Start consuming messages from the queue
 */
export async function startConsuming(messageHandler) {
  if (!channel) {
    throw new Error("RabbitMQ channel not initialized");
  }

  // Prefetch 1 message at a time for load control
  await channel.prefetch(1);

  channel.consume(QUEUE_NAME, async (msg) => {
    if (msg) {
      try {
        const content = JSON.parse(msg.content.toString());
        console.log(`Message received (${msg.fields.deliveryTag}):`, content);

        // Call the message handler
        await messageHandler(content);

        // Acknowledge the message
        channel.ack(msg);
        console.log("Message acknowledged");
      } catch (err) {
        console.error("Error processing message:", err);
        // Negative acknowledge - requeue the message
        channel.nack(msg, false, true);
        console.log("Message nacked and requeued");
      }
    }
  });

  console.log("Consumer started, waiting for messages...");
}

/**
 * Publish an event to the topic exchange
 */
export async function publishEvent(routingKey, eventEnvelope) {
  if (!channel) {
    throw new Error("RabbitMQ channel not initialized");
  }

  const message = Buffer.from(JSON.stringify(eventEnvelope));

  try {
    channel.publish(EXCHANGE_NAME, routingKey, message, {
      persistent: true,
      contentType: "application/json",
    });

    console.log(`Event published: ${routingKey}`, eventEnvelope);
  } catch (err) {
    console.error("Failed to publish event:", err);
    throw err;
  }
}

/**
 * Close RabbitMQ connection
 */
export async function closeRabbitMQ() {
  if (channel) {
    await channel.close();
  }
  if (connection) {
    await connection.close();
  }
  console.log("RabbitMQ connection closed");
}
