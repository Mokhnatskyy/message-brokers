import amqp from "amqplib";

const EXCHANGE_NAME = "job-events";
const QUEUE_OPTIONS = { durable: true };

let connection = null;
let channel = null;

/**
 * Connect to RabbitMQ and ensure exchange/queue topology exists
 */
export async function connectRabbitMQ(url) {
  try {
    connection = await amqp.connect(url);

    connection.on("error", (err) => {
      console.error("RabbitMQ connection error:", err);
    });

    channel = await connection.createChannel();

    // Declare topic exchange
    await channel.assertExchange(EXCHANGE_NAME, "topic", { durable: true });

    console.log("RabbitMQ connected and topology ready");
    return channel;
  } catch (err) {
    console.error("Failed to connect to RabbitMQ:", err);
    throw err;
  }
}

/**
 * Publish an event to the topic exchange
 * Messages are persistent and will survive RabbitMQ restarts
 */
export async function publishEvent(routingKey, eventEnvelope) {
  if (!channel) {
    throw new Error("RabbitMQ channel not initialized");
  }

  const message = Buffer.from(JSON.stringify(eventEnvelope));

  channel.publish(
    EXCHANGE_NAME,
    routingKey,
    message,
    {
      persistent: true,
      contentType: "application/json",
    }
  );

  console.log(`✓ Event published: ${routingKey}`, {
    eventId: eventEnvelope.eventId,
    eventType: eventEnvelope.eventType,
  });
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
