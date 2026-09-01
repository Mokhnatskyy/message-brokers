# Event-Driven Architecture: Complete Overview

## Executive Summary

This project demonstrates a **production-ready event-driven architecture** for asynchronous job processing using RabbitMQ, MongoDB, and Node.js. It implements 5 critical reliability patterns that ensure no events are lost and all operations are idempotent.

---

## Core Concept

**Event-Driven Architecture** decouples services using events as the contract:
- Service A takes an action and emits an event
- Service B listens for that event and reacts
- Services don't call each other directly
- Highly scalable, resilient, and independently deployable

### Example Flow

```
User creates job via API
       ↓
API stores job in database
       ↓
API publishes "job.created" event
       ↓
Worker receives "job.created"
       ↓
Worker processes job
       ↓
Worker publishes "job.completed" or "job.failed"
       ↓
[Other services can listen and react]
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT (User)                         │
│                     POST /jobs {title}                       │
└────────────────────────────┬────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │   API Service   │
                    │   (Express.js)  │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
   ┌─────────┐          ┌─────────┐         ┌──────────┐
   │ MongoDB │          │RabbitMQ │         │ Outbox   │
   │         │          │ Exchange│         │Publisher │
   │ ├─jobs  │          │         │         │          │
   │ ├─outbox│          │  Topic  │         │ (loop 5s)│
   │ └─idempotency      │ Exchange│         └────┬─────┘
   └─────────┘          └────┬────┘              │
        ▲                    │                   │
        │                    └───────────────────┘
        │                                    (check unpublished)
        │
   ┌────┴──────────────────────────────────────┐
   │                                            │
   ▼                                            ▼
┌──────────────────────────────────────────────────────┐
│              RabbitMQ Queues & Routing               │
├──────────────────────────────────────────────────────┤
│                                                      │
│  job-events exchange (topic)                        │
│         │                                           │
│    ┌────┴─────────┬──────────┐                      │
│    │              │          │                      │
│    ▼              ▼          ▼                       │
│ [job.created] [job.completed] [job.failed]         │
│   queue         queue           queue              │
│    │                                               │
│    └─→ [job.created.retry]     [job.created.dlq]   │
│        (TTL: 5s)               (TTL: 24h)         │
│        ↓ (on TTL expire)       (failed messages)   │
│        └───→ [job-events-dlq exchange]            │
│                                                     │
└──────────────────────────────────────────────────────┘
   │
   │ (processes)
   ▼
┌──────────────────┐
│ Worker Service   │
│  (Node.js)       │
└────────┬─────────┘
         │
    ┌────┴─────────┬──────────────────┐
    │              │                  │
    ▼              ▼                  ▼
 Consumes     Processes          Publishes
 job.created  job details      job.completed
              (1 second)       or job.failed

    │
    ▼
 [MongoDB updated with result]
```

---

## Key Components

### 1. API Service (`api/src/`)

**Responsibility:** Accept commands, store state, publish events

**Files:**
- `index.js` - Express server, POST /jobs endpoint
- `rabbitmq.js` - Publisher with confirms
- `mongodb.js` - Database operations
- `outbox-publisher.js` - Background service for outbox pattern

**Key Operations:**
```javascript
1. POST /jobs {title}
   ├─ Save job to MongoDB (status: created)
   ├─ Store event in outbox (published: false)
   ├─ Publish to RabbitMQ
   └─ Mark outbox published (published: true)

2. GET /jobs/{jobId}
   └─ Return job with event history
```

### 2. Worker Service (`worker/src/`)

**Responsibility:** Consume events, process work, publish results

**Files:**
- `index.js` - Consumer logic, job processor
- `rabbitmq.js` - Consumer with retry/DLQ topology
- `mongodb.js` - Database operations for worker

**Key Operations:**
```javascript
1. Consume from job.created queue
   ├─ Check idempotency (skip if already processed)
   ├─ Get job details from MongoDB
   ├─ Process for 1 second (simulated)
   ├─ Update job status (completed/failed)
   ├─ Record idempotency key
   └─ Publish job.completed or job.failed

2. Error Handling
   ├─ On failure: nack + requeue to retry queue
   ├─ After 5s TTL: retry from main queue
   └─ If still failing: go to DLQ for manual review
```

### 3. Shared Contracts (`shared/types.js`)

**Responsibility:** Define event envelope and routing keys

**Event Envelope Structure:**
```javascript
{
  eventId: "unique-id",           // For idempotency
  eventType: "job.created",       // Domain event
  version: 1,                     // Schema version
  occurredAt: "2024-01-15T...",  // When it happened
  correlationId: "trace-id",      // Trace across services
  causationId: "parent-event-id", // Causal relationship
  payload: { jobId, title, ... }  // Business data
}
```

**Routing Keys:**
- `job.created` - When job is created
- `job.completed` - When job finishes successfully
- `job.failed` - When job fails

---

## 5 Reliability Patterns

### Pattern 1: Publisher Confirms

**Problem:** How do we know if RabbitMQ safely stored our message?

**Solution:**
- Enable `channel.confirmSelect()`
- RabbitMQ sends back confirmation for each message
- Only return success to client after confirm received

**Code:**
```javascript
// API
channel.confirmSelect(() => console.log("Confirms enabled"));
channel.on("confirm", (tag, multiple) => {
  console.log(`Message ${tag} confirmed`);
});

// When publishing, wait for confirm before returning to client
await publishEvent(routingKey, event);
```

**Guarantees:**
- ✅ API only says "done" if RabbitMQ has safely stored message
- ✅ Messages survive RabbitMQ restarts (persistent + confirmed)

---

### Pattern 2: Consumer Idempotency

**Problem:** What if the same message is delivered twice?

**Solution:**
- Track which events have been processed (eventId in DB)
- Before processing, check if eventId already seen
- If yes, skip and return success
- If no, process and record eventId

**Code:**
```javascript
// Worker
const alreadyProcessed = await isEventAlreadyProcessed(eventId);
if (alreadyProcessed) {
  console.log("Event already processed, skipping");
  return; // Don't process again
}

// Process event...
await recordProcessedEvent(eventId, eventType);
```

**Guarantees:**
- ✅ Same event processed only once, even if delivered multiple times
- ✅ No duplicate job status updates
- ✅ Safe to retry delivery without side effects

---

### Pattern 3: Retry Queue

**Problem:** What if worker is temporarily down or has a transient error?

**Solution:**
- Configure main queue with dead-letter exchange pointing to retry queue
- Retry queue has TTL (5 seconds)
- Failed message is nacked, goes to retry queue
- After TTL expires, message returns to main queue for retry

**Topology:**
```
job.created queue
    │ (on nack)
    ├─ x-dead-letter-exchange: job-events-retry
    │
job.created.retry queue
    │ (TTL: 5 seconds)
    ├─ x-message-ttl: 5000
    │
    └─ (after TTL expires)
       └─ Returns to job.created queue
```

**Code:**
```javascript
// Worker - on error
channel.nack(msg, false, true); // Requeue without acknowledge
// Message goes to retry queue, retried after 5s
```

**Guarantees:**
- ✅ Transient failures automatically retried
- ✅ No manual intervention needed
- ✅ Worker has time to recover (5 seconds)

---

### Pattern 4: Dead-Letter Exchange (DLQ)

**Problem:** What if a message fails repeatedly? How do we debug?

**Solution:**
- Retry queue has dead-letter exchange pointing to DLQ
- After retry TTL expires, message goes to DLQ instead of main queue (if exhausted)
- DLQ messages retained for 24 hours
- Ops can inspect and manually retry

**Topology:**
```
job.created.retry queue
    │ (TTL expires, multiple times)
    ├─ x-dead-letter-exchange: job-events-dlq
    │
job.created.dlq queue
    │ (TTL: 24 hours)
    └─ (for manual inspection & retry)
```

**RabbitMQ UI Access:**
1. Go to http://localhost:15672 (guest:guest)
2. Click "Queues and Streams"
3. Find `job.created.dlq`
4. View message payload for debugging

**Guarantees:**
- ✅ Failed messages don't disappear
- ✅ Available for debugging for 24 hours
- ✅ Can be manually retried or analyzed

---

### Pattern 5: Outbox Pattern

**Problem:** What if API publishes event but RabbitMQ is down?

**Solution:**
1. Store event in local `outbox` collection first (published: false)
2. Publish to RabbitMQ
3. On success, mark as published (published: true)
4. Background service runs every 5 seconds
5. Finds unpublished events and republishes them
6. If RabbitMQ comes back, all events are republished

**Flow:**
```
POST /jobs
  ├─ Save job to MongoDB
  ├─ Store event in outbox (published: false) ← GUARANTEED
  ├─ Try publish to RabbitMQ
  │  ├─ Success: mark outbox published: true
  │  └─ Failure: stays in outbox
  │
[Background - every 5s]
  └─ Find unpublished events
     ├─ Publish to RabbitMQ
     └─ Mark published
```

**Code:**
```javascript
// API
await storeOutboxEvent(eventId, routingKey, event); // Always succeeds
try {
  await publishEvent(routingKey, event);
  await markOutboxPublished(eventId);
} catch (err) {
  // Event stays in outbox, will retry
  console.log("Will retry from outbox");
}

// outbox-publisher.js (runs every 5 seconds)
const unpublished = await getUnpublishedOutboxEvents();
for (const event of unpublished) {
  await publishEvent(event.routingKey, event.envelope);
  await markOutboxPublished(event.eventId);
}
```

**Guarantees:**
- ✅ No event is ever lost
- ✅ Even if RabbitMQ is down, events are queued locally
- ✅ Automatic recovery when RabbitMQ comes back
- ✅ Background service ensures delivery

---

## MongoDB Schema

### Collections

#### `jobs`
```javascript
{
  _id: ObjectId(...),
  jobId: "unique-id",           // Unique constraint
  title: "Process payment",
  description: "...",
  status: "completed",           // created|completed|failed
  createdAt: ISODate(...),
  updatedAt: ISODate(...),
  events: [
    {
      eventType: "job.created",
      timestamp: ISODate(...)
    },
    {
      eventType: "job.completed",
      timestamp: ISODate(...),
      result: { processedAt: "..." }
    }
  ]
}

Indexes:
- jobId (unique)
- status
- createdAt
```

#### `idempotency`
```javascript
{
  _id: ObjectId(...),
  eventId: "unique-event-id",    // Unique constraint
  eventType: "job.created",
  processedAt: ISODate(...),
  workerProcessed: true
}

Indexes:
- eventId (unique)
```

#### `outbox`
```javascript
{
  _id: ObjectId(...),
  eventId: "unique-event-id",    // Unique constraint
  routingKey: "job.created",
  eventEnvelope: { /* full event */ },
  published: false,              // true after successful publish
  createdAt: ISODate(...),
  publishedAt: null              // Set after published
}

Indexes:
- eventId (unique)
- published
- createdAt
```

---

## RabbitMQ Topology

### Exchanges

| Exchange | Type | Durable | Purpose |
|----------|------|---------|---------|
| `job-events` | topic | yes | Main event exchange |
| `job-events-retry` | topic | yes | Retry queue exchange |
| `job-events-dlq` | topic | yes | Dead-letter exchange |

### Queues

| Queue | Durable | Arguments | Purpose |
|-------|---------|-----------|---------|
| `job.created` | yes | DLX: job-events-retry | Main queue for job creation events |
| `job.created.retry` | yes | TTL: 5s, DLX: job-events-dlq | Temporary retry queue |
| `job.created.dlq` | yes | TTL: 24h | Dead-letter queue for failed messages |

### Bindings

| Queue | Exchange | Routing Key |
|-------|----------|-------------|
| job.created | job-events | job.created |
| job.created.retry | job-events-retry | job.created |
| job.created.dlq | job-events-dlq | job.* |

---

## Message Flow Timeline

### Happy Path (No Failures)

```
T+0ms    : API receives POST /jobs
T+1ms    : Job saved to MongoDB (status: created)
T+2ms    : Event stored in outbox (published: false)
T+3ms    : Event published to RabbitMQ
T+4ms    : RabbitMQ confirms receipt
T+5ms    : Outbox updated (published: true)
T+6ms    : API returns 201 success to client
           │
T+7ms    : Worker receives message from job.created queue
T+8ms    : Worker checks idempotency - NOT found
T+9ms    : Worker processes job (sleeps 1000ms)
T+1009ms : Job status updated to completed
T+1010ms : Idempotency key recorded
T+1011ms : job.completed event published
T+1012ms : Message acknowledged (ack)
           │
T+1013ms : Job stored in MongoDB with full event history
```

### With Transient Failure (Message Retry)

```
T+0ms    : Worker receives message
T+1ms    : Worker processing fails (simulated error)
T+2ms    : Message nacked with requeue=true
T+3ms    : Message sent to retry queue
T+4ms    : Retry queue holds message for 5 seconds (TTL)
T+5004ms : TTL expires, message returns to main queue
T+5005ms : Worker receives message again
T+5006ms : Worker checks idempotency - FOUND (already processed)
T+5007ms : Worker skips processing, returns success
T+5008ms : Message acknowledged
```

### With Permanent Failure (DLQ)

```
T+0ms    : Worker receives message
T+1ms    : Worker processing fails
T+2ms    : Message nacked, goes to retry queue (attempt 1)
T+5004ms : TTL expires, returns to main queue
T+5005ms : Worker receives message (attempt 2)
T+5006ms : Processing fails again
T+5007ms : Message nacked, goes to retry queue (attempt 2)
T+10004ms: TTL expires again, goes to DLQ instead
T+10005ms: Message stored in DLQ for 24 hours
           │
           (Available for ops to inspect and manually retry)
```

### With RabbitMQ Outage (Outbox Pattern)

```
T+0ms    : API receives POST /jobs
T+1ms    : Job saved to MongoDB
T+2ms    : Event stored in outbox (published: false)
T+3ms    : Publish to RabbitMQ FAILS (down)
T+4ms    : Event stays in outbox (published: false)
T+5ms    : API returns error to client (or retry internally)
           │
T+5000ms : Outbox publisher runs (every 5s)
T+5001ms : Finds unpublished event
T+5002ms : RabbitMQ still down - publish fails
T+5003ms : Event stays in outbox
           │
T+10000ms: Outbox publisher runs again
T+10001ms: RabbitMQ is back online
T+10002ms: Republishes event successfully
T+10003ms: Updates outbox (published: true)
T+10004ms: Worker consumes event (no message loss!)
```

---

## Guarantees & Properties

### Exactly-Once Semantics

| Concern | Guarantee | How |
|---------|-----------|-----|
| Publish | At-least-once | Publisher confirms + persistent messages |
| Consume | Exactly-once | Idempotency keys (eventId in DB) |
| End-to-end | Exactly-once | Combine both above |

### Fault Tolerance

| Failure | Recovery |
|---------|----------|
| Transient worker error | Automatic retry (5s) |
| Permanent worker error | Message in DLQ (24h) |
| RabbitMQ temporary outage | Outbox republishes (5s background) |
| MongoDB temporary outage | API requests will fail (can retry client-side) |
| Network partition | Publisher confirms + idempotency handles it |

### Non-Repudiation (Audit Trail)

- All events stored in `jobs.events` array
- Timestamps for each event
- Correlation IDs for tracing
- Causation IDs for causal ordering

---

## Performance Characteristics

| Operation | Latency | Throughput |
|-----------|---------|-----------|
| POST /jobs | ~10-20ms | Limited by job processing (1s/job in demo) |
| Publish | Async (confirms after ~1-5ms) | 100+ msgs/sec per channel |
| Consume | Process time + network | 1000s/sec per worker |
| Database write | ~5-10ms | 1000s/sec (single node) |

**To increase throughput:**
- Add more workers (horizontal scaling)
- Use multiple RabbitMQ channels
- Scale MongoDB with replication set
- Use prefetch to control load

---

## Deployment Checklist

- [ ] All 5 reliability patterns tested (see TESTING.md)
- [ ] Monitoring configured (logs, metrics, alerts)
- [ ] Database backups enabled
- [ ] RabbitMQ persistence enabled (persistent messages)
- [ ] Consumer prefetch tuned for load
- [ ] Outbox publisher running (background job)
- [ ] Error handling for all operations
- [ ] Graceful shutdown implemented (ack pending messages)
- [ ] Health checks on all services
- [ ] Load testing done

---

## References & Learning

- [Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)
- [CQRS Pattern](https://martinfowler.com/bliki/CQRS.html)
- [Saga Pattern](https://microservices.io/patterns/data/saga.html)
- [RabbitMQ Docs](https://www.rabbitmq.com/documentation.html)
- [MongoDB Transactions](https://docs.mongodb.com/manual/core/transactions/)

---

## Summary

This architecture demonstrates:
- ✅ **Decoupling:** Services don't call each other
- ✅ **Reliability:** 5 patterns ensure no event loss
- ✅ **Scalability:** Horizontal scaling via multiple workers
- ✅ **Observability:** Event history in MongoDB
- ✅ **Production-Ready:** Tested failure modes

**The next steps:**
1. Test all scenarios (see TESTING.md)
2. Deploy to Kubernetes or Docker Swarm
3. Add monitoring (Prometheus, Grafana)
4. Add more event types (API business logic)
5. Extend with CQRS (separate read/write models)
