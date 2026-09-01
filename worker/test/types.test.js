import { test } from "node:test";
import assert from "node:assert";
import {
  createEventEnvelope,
  RoutingKeys,
  generateId,
} from "../../shared/types.js";

test("EventEnvelope - createEventEnvelope creates valid envelope", () => {
  const payload = { jobId: "123", title: "Test" };
  const correlationId = "trace-123";

  const envelope = createEventEnvelope(
    RoutingKeys.JOB_CREATED,
    payload,
    correlationId
  );

  assert.strictEqual(envelope.eventType, RoutingKeys.JOB_CREATED);
  assert.deepStrictEqual(envelope.payload, payload);
  assert.strictEqual(envelope.correlationId, correlationId);
  assert.strictEqual(envelope.version, 1);
  assert.ok(envelope.eventId);
  assert.ok(envelope.occurredAt);
});

test("RoutingKeys - has all expected keys", () => {
  assert.strictEqual(RoutingKeys.JOB_CREATED, "job.created");
  assert.strictEqual(RoutingKeys.JOB_COMPLETED, "job.completed");
  assert.strictEqual(RoutingKeys.JOB_FAILED, "job.failed");
});

test("generateId - creates unique IDs", () => {
  const id1 = generateId();
  const id2 = generateId();

  assert.ok(id1);
  assert.ok(id2);
  assert.notStrictEqual(id1, id2);
  assert.match(id1, /^\d+-[a-z0-9]+$/);
});
