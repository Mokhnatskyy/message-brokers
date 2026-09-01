import {
  getUnpublishedOutboxEvents,
  markOutboxPublished,
  cleanupPublishedOutbox,
} from "./mongodb.js";
import { publishEvent } from "./rabbitmq.js";

/**
 * Outbox Publisher
 * Background service that republishes events from the outbox
 * Ensures no events are lost even if RabbitMQ is temporarily unavailable
 */

let isRunning = false;

export async function startOutboxPublisher(intervalMs = 5000) {
  console.log(`Starting outbox publisher (interval: ${intervalMs}ms)`);

  // Run immediately on start
  await publishUnpublishedEvents();

  // Then run periodically
  setInterval(async () => {
    try {
      await publishUnpublishedEvents();
      await cleanupOldPublishedEvents();
    } catch (err) {
      console.error("Outbox publisher error:", err.message);
    }
  }, intervalMs);

  isRunning = true;
}

async function publishUnpublishedEvents() {
  try {
    const unpublished = await getUnpublishedOutboxEvents();

    if (unpublished.length === 0) {
      return;
    }

    console.log(`Outbox: Found ${unpublished.length} unpublished events`);

    for (const doc of unpublished) {
      try {
        const { eventId, routingKey, eventEnvelope } = doc;
        console.log(`Outbox: Publishing event ${eventId}`);

        await publishEvent(routingKey, eventEnvelope);
        await markOutboxPublished(eventId);

        console.log(`Outbox: Event ${eventId} published successfully`);
      } catch (err) {
        console.error(
          `Outbox: Failed to publish event ${doc.eventId}:`,
          err.message
        );
        // Don't throw - continue with other events
      }
    }
  } catch (err) {
    console.error("Outbox publisher failed:", err.message);
  }
}

async function cleanupOldPublishedEvents() {
  try {
    const deleted = await cleanupPublishedOutbox();
    if (deleted > 0) {
      console.log(`Outbox: Cleaned up ${deleted} old published events`);
    }
  } catch (err) {
    console.error("Outbox cleanup error:", err.message);
  }
}

export function isOutboxPublisherRunning() {
  return isRunning;
}
