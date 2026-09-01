/**
 * Shared event types and contracts for the message-brokers project.
 * These types are imported by both API and worker services.
 */

/**
 * Standard event envelope for all messages published to RabbitMQ.
 * Supports idempotency, tracing, and event sourcing patterns.
 *
 * @typedef {Object} EventEnvelope
 * @property {string} eventId - Unique identifier for this event instance
 * @property {string} eventType - Type of domain event (e.g., "job.created")
 * @property {number} version - Version of the event schema
 * @property {string} occurredAt - ISO 8601 timestamp when the event occurred
 * @property {string} correlationId - Trace ID for following a request across services
 * @property {string} [causationId] - ID of the event that caused this event
 * @property {unknown} payload - The actual business data
 */

/**
 * Job domain event payloads
 */

/**
 * @typedef {Object} JobCreatedPayload
 * @property {string} jobId
 * @property {string} title
 * @property {string} [description]
 * @property {string} createdAt
 */

/**
 * @typedef {Object} JobCompletedPayload
 * @property {string} jobId
 * @property {unknown} [result]
 * @property {string} completedAt
 */

/**
 * @typedef {Object} JobFailedPayload
 * @property {string} jobId
 * @property {string} reason
 * @property {string} failedAt
 */

/**
 * Event routing keys for RabbitMQ topic exchange bindings
 */
const RoutingKeys = {
  JOB_CREATED: "job.created",
  JOB_COMPLETED: "job.completed",
  JOB_FAILED: "job.failed",
};

/**
 * Helper to create a new event envelope
 * @param {string} eventType
 * @param {unknown} payload
 * @param {string} correlationId
 * @param {string} [causationId]
 * @returns {EventEnvelope}
 */
function createEventEnvelope(eventType, payload, correlationId, causationId) {
  return {
    eventId: generateId(),
    eventType,
    version: 1,
    occurredAt: new Date().toISOString(),
    correlationId,
    causationId,
    payload,
  };
}

/**
 * Simple ID generator (replace with UUID in production)
 * @returns {string}
 */
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

module.exports = {
  RoutingKeys,
  createEventEnvelope,
  generateId,
};
