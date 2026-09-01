import amqp from "amqplib";

const EXCHANGE_NAME = "job-events";
const QUEUE_OPTIONS = { durable: true };

let connection = null;
let channel = null;

/**
 * Connect to RabbitMQ and ensure exchange/queue topology exists
 * Publisher confirms enabled for reliable publishing
 */
export async function connectRabbitMQ(url) {
  try {
    connection = await amqp.connect(url);

    connection.on("error", (err) => {
      console.error("RabbitMQ connection error:", err);
    });

    channel = await connection.createChannel();

    // Set up publisher confirms callback-based
    channel.on("confirm", (deliveryTag, multiple) => {
      console.log(`✓ Publisher confirm received (tag: ${deliveryTag})`);
    });

    channel.on("return", (msg) => {
      console.warn("✗ Message returned by broker:", msg.properties.messageId);
    });

    // Enable confirms on this channel
    channel.confirmSelect(() => {
      console.log("Publisher confirms enabled");
    });

    // Declare topic exchange
    await channel.assertExchange(EXCHANGE_NAME, "topic", { durable: true });

    console.log("RabbitMQ connected with publisher confirms");
    return channel;
  } catch (err) {
    console.error("Failed to connect to RabbitMQ:", err);
    throw err;
  }
}

/**
 * Publish an event to the topic exchange
 * - Persistent messages survive RabbitMQ restarts
 * - Publisher confirms ensure RabbitMQ acknowledges receipt
 */
export async function publishEvent(routingKey, eventEnvelope) {
  if (!channel) {
    throw new Error("RabbitMQ channel not initialized");
  }

  const message = Buffer.from(JSON.stringify(eventEnvelope));

  return new Promise((resolve, reject) => {
    try {
      const ok = channel.publish(
        EXCHANGE_NAME,
        routingKey,
        message,
        {
          persistent: true,
          contentType: "application/json",
          messageId: eventEnvelope.eventId, // Track by event ID
        }
      );

      if (!ok) {
        return reject(new Error("Failed to queue message for publishing"));
      }

      console.log(`Event published: ${routingKey}`, {
        eventId: eventEnvelope.eventId,
        eventType: eventEnvelope.eventType,
      });

      resolve();
    } catch (err) {
      console.error("Error publishing event:", err);
      reject(err);
    }
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
