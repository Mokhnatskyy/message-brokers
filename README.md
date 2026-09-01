# message-brokers

Learning RabbitMQ, messaging patterns, and async processing through a distributed event-driven architecture.

## Project Overview

This project builds an async processing platform with:
- **API Service** — Express server that accepts commands and publishes events to RabbitMQ
- **Worker Service** — Consumes events from RabbitMQ and processes jobs
- **Event Contracts** — Shared event types and helpers for message envelope
- **RabbitMQ** — Topic exchange for pub/sub messaging with routing keys
- **MongoDB** — Stores job state, idempotency records, and processing history

## Current Status

**Milestone 1: Project Skeleton** ✓
- Project structure (api/, worker/, shared/)
- Event envelope and job domain events defined
- Shared event types and helpers
- Basic API and worker skeletons
- Environment config template

**Milestone 2: Local Infrastructure** ✓
- Docker Compose with RabbitMQ, MongoDB, API, and worker
- Dockerfiles for API and worker services
- Health checks for all services
- Volume persistence for RabbitMQ and MongoDB
- Hot-reload for development

**Milestone 3: First Message Flow** ✓
- API connects to MongoDB and RabbitMQ
- POST /jobs endpoint creates jobs and publishes job.created events
- Worker consumes job.created events and processes jobs
- Worker publishes job.completed or job.failed events
- Full end-to-end message flow with logging

**Milestone 4: Reliability Patterns** ✓
- Publisher confirms: API waits for RabbitMQ to confirm message receipt
- Consumer idempotency: Worker tracks processed eventIds to prevent duplicates
- Retry queue: Failed messages automatically retried after 5 seconds
- Dead-letter exchange (DLQ): Messages that exhaust retries go to DLQ for debugging
- Full reliability flow with comprehensive logging

**Milestone 5: CI/CD and Tests** ✓
- Unit tests for event envelope and shared types
- Linting with ESLint for both services
- GitHub Actions workflow for test, lint, and Docker build on push/PR
- Release workflow for creating tagged Docker images on version tags
- Integration test infrastructure (RabbitMQ, MongoDB services)

## Project Structure

```
message-brokers/
├── api/                  # Express API service
│   ├── src/
│   │   └── index.js      # Server skeleton, health endpoint
│   └── package.json
├── worker/               # RabbitMQ consumer service
│   ├── src/
│   │   └── index.js      # Consumer skeleton
│   └── package.json
├── shared/               # Event types and contracts
│   ├── types.js          # EventEnvelope, job payloads, routing keys
│   └── package.json
├── .env.example          # Environment variable template
├── AGENTS.md             # Architecture rules and coding guidelines
└── README.md             # This file
```

## Event Architecture

### Event Envelope

All messages follow a standard envelope structure:

```javascript
{
  eventId: "1234567890-abc123",    // Unique event ID
  eventType: "job.created",         // Domain event type
  version: 1,                       // Schema version for compatibility
  occurredAt: "2024-01-15T...",     // ISO 8601 timestamp
  correlationId: "trace-id",        // Trace ID across services
  causationId: undefined,           // ID of event that caused this event
  payload: { jobId, title, ... }    // Business data
}
```

### Job Domain Events

- **job.created** — API created a new job
- **job.completed** — Worker completed the job
- **job.failed** — Worker failed to process the job

See `shared/types.js` for full definitions.

### Routing Keys

Events are published to a topic exchange with routing keys for selective binding:
- `job.created`
- `job.completed`
- `job.failed`

## Local Setup

### Prerequisites

- Node.js 18+ (20+ recommended)
- npm or yarn
- RabbitMQ (local or Docker, see Milestone 2)
- MongoDB (local or Docker, see Milestone 2)

### Option 1: Docker Compose (Recommended)

**Prerequisites:**
- Docker and Docker Compose

**Start all services:**

```bash
docker-compose up
```

This starts:
- **API** on http://localhost:3000
- **RabbitMQ Management UI** on http://localhost:15672 (guest:guest)
- **MongoDB** on localhost:27017 (admin:admin)
- **Worker** listening for messages

Check services are healthy:

```bash
docker-compose ps
```

Stop services:

```bash
docker-compose down
```

Clean up volumes (reset data):

```bash
docker-compose down -v
```

### Option 2: Local Development

**Prerequisites:**
- Node.js 18+ (20+ recommended)
- npm or yarn
- RabbitMQ running locally
- MongoDB running locally

**Install Dependencies:**

```bash
# API service
cd api && npm install && cd ..

# Worker service
cd worker && npm install && cd ..
```

**Environment Variables:**

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

**Run API Service:**

```bash
cd api
npm run dev
```

**Run Worker Service (in another terminal):**

```bash
cd worker
npm run dev
```

## Services & Ports

| Service | Port | Details |
|---------|------|---------|
| API | 3000 | Express server, health checks, command endpoints |
| RabbitMQ | 5672 | AMQP protocol for message publishing/consuming |
| RabbitMQ UI | 15672 | Management interface (guest:guest) |
| MongoDB | 27017 | Database for job state and idempotency (admin:admin) |

## RabbitMQ Topology (Planned for Milestone 3)

**Exchange:**
- `job-events` (topic exchange)

**Queues:**
- `job.created` — Worker consumes job creation events
- `job.completed` — API consumes job completion events
- `job.failed` — API consumes job failure events
- `job-retry` — Retry queue with TTL
- `job-dlq` — Dead-letter queue for unprocessable messages

**Routing Keys:**
- `job.created`
- `job.completed`
- `job.failed`

## Testing the Message Flow

**Start all services:**
```bash
docker-compose up
```

**Create a job (in another terminal):**
```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"title": "My first job"}'
```

**Watch the logs:**
```bash
# See API logs
docker-compose logs -f api

# See worker logs
docker-compose logs -f worker

# See all logs
docker-compose logs -f
```

**Verify RabbitMQ:**
- Go to http://localhost:15672 (guest:guest)
- Click on "Exchanges" tab
- You should see `job-events` exchange
- Click on "Queues and Streams" tab
- You should see `job.created` queue

**Verify MongoDB:**
- Use MongoDB client or compass to connect to localhost:27017
- Database: `message_brokers`
- Collection: `jobs`
- Check job status progression

## Message Flow Diagram

```
1. API receives POST /jobs
   ↓
2. API saves job to MongoDB (status: "created")
   ↓
3. API publishes job.created event to RabbitMQ
   ↓
4. Worker consumes job.created from queue
   ↓
5. Worker processes the job (simulates 1 second work)
   ↓
6. Worker updates MongoDB (status: "completed")
   ↓
7. Worker publishes job.completed event
   ↓
8. (Future: API or other services can consume job.completed)
```

## Reliability Patterns Implemented

### 1. Publisher Confirms (API → RabbitMQ)

The API waits for RabbitMQ to confirm that messages are safely stored before returning success to the client.

```javascript
// API publishes with confirmation callback
await publishEvent(routingKey, event);
// ✓ Event published and confirmed
```

### 2. Consumer Idempotency (Worker)

The worker tracks which events it has processed. If the same event arrives twice (e.g., due to delivery retry), it's processed only once.

```javascript
// Worker checks if event already processed
const alreadyProcessed = await isEventAlreadyProcessed(eventId);
if (alreadyProcessed) {
  console.log("⚠ Event already processed, skipping");
  return;
}

// Record as processed to prevent duplicates
await recordProcessedEvent(eventId, "job.created");
```

### 3. Retry Queue (Dead-Letter Routing)

When a message fails processing:
1. Worker throws an error
2. Message is negatively acknowledged (nacked) and requeued
3. Message goes to retry queue
4. After 5 seconds (TTL), message returns to main queue for retry

### 4. Dead-Letter Exchange (DLQ)

When a message fails multiple retry attempts:
1. Message goes to job-events-dlq exchange
2. Stored in job.created.dlq queue for 24 hours
3. Available for manual inspection and reprocessing

### Topology Diagram

```
job.created event
    ↓
[job-events] exchange (topic)
    ↓
[job.created] queue
    ↓
Worker processes (success? ✓ → ack)
         ↓ (failure? ✗ → nack)
[job.created.retry] queue (TTL: 5s)
    ↓ (TTL expires)
[job-events-dlq] exchange
    ↓
[job.created.dlq] queue (TTL: 24h)
```

## Testing Reliability Features

### Test 1: Basic Flow (Already working)
```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"title": "Test job"}'

# Watch logs:
docker-compose logs -f api worker
```

### Test 2: Simulate Message Loss & Retry
Uncomment the simulated error in `worker/src/index.js`:
```javascript
// Simulate occasional failures for testing retry behavior
if (Math.random() < 0.3) throw new Error("Simulated processing error");
```

Then restart:
```bash
docker-compose down -v
docker-compose up
```

Create a job and watch:
- First attempt fails → message nacked
- After 5 seconds, message retried from retry queue
- Second attempt succeeds
- Idempotency prevents double processing

### Test 3: Check Retry & DLQ Queues

**RabbitMQ Management UI** (http://localhost:15672, guest:guest):
1. Go to "Queues and Streams" tab
2. You should see:
   - `job.created` — Main queue
   - `job.created.retry` — Retry queue (empty most of the time due to 5s TTL)
   - `job.created.dlq` — Dead-letter queue (for failed messages)

### Test 4: Monitor Idempotency

Create the same job ID twice:
```bash
# Check MongoDB idempotency collection
```

Worker processes first event and records it. If the event arrives again (network retry, etc.), the worker skips it due to idempotency.

## Testing

### Run Unit Tests Locally

**API Tests:**
```bash
cd api
npm install
npm test
```

**Worker Tests:**
```bash
cd worker
npm install
npm test
```

Watch mode (auto-rerun on file changes):
```bash
npm run test:watch
```

### Linting

**Lint API:**
```bash
cd api && npm run lint
```

**Lint Worker:**
```bash
cd worker && npm run lint
```

### Integration Tests

Start services:
```bash
docker-compose up
```

Tests run automatically via GitHub Actions when you push or create a PR.

## CI/CD Pipeline

### GitHub Actions Workflows

**Test Workflow** (`.github/workflows/test.yml`)
- Runs on every push and pull request
- Tests with Node.js 18.x and 20.x
- Steps:
  1. Lint API and Worker (ESLint)
  2. Run unit tests
  3. Build Docker images
  4. Run integration tests with live RabbitMQ and MongoDB services

**Release Workflow** (`.github/workflows/release.yml`)
- Runs when you push a version tag (e.g., `v0.1.0`)
- Builds Docker images with version tags
- Creates GitHub release with Docker image tags

### Create a Release

```bash
# Tag a version
git tag v0.1.0

# Push the tag to trigger the release workflow
git push origin v0.1.0
```

GitHub Actions will:
1. Build API image: `message-brokers-api:0.1.0`
2. Build Worker image: `message-brokers-worker:0.1.0`
3. Create a GitHub Release with image references

## Project Checklist

- ✅ Event-driven architecture with event envelope
- ✅ API service (Express, MongoDB, RabbitMQ publisher)
- ✅ Worker service (RabbitMQ consumer, job processing)
- ✅ Docker Compose for local development
- ✅ Publisher confirms for reliable publishing
- ✅ Consumer idempotency for safe retries
- ✅ Retry queue and dead-letter exchange
- ✅ Unit tests and linting
- ✅ GitHub Actions CI/CD pipeline
- ✅ Docker image builds and releases

## Next Steps

1. **Explore the codebase:**
   - API: `api/src/`
   - Worker: `worker/src/`
   - Shared types: `shared/types.js`

2. **Test locally:**
   ```bash
   docker-compose up
   curl -X POST http://localhost:3000/jobs -H "Content-Type: application/json" -d '{"title":"My first job"}'
   docker-compose logs -f
   ```

3. **Explore reliability features:**
   - Enable simulated errors to test retry/DLQ
   - Monitor RabbitMQ UI: http://localhost:15672
   - Check MongoDB for job documents

4. **Extend the project:**
   - Add more job types and processing logic
   - Implement the outbox pattern for reliable event publishing
   - Add API consumer for job completion events
   - Build a UI dashboard for job monitoring

## Learning Goals

This project demonstrates:
1. **Async Processing** — Decoupled producer-consumer architecture
2. **Event-Driven Design** — Events as the contract between services
3. **Idempotency** — Handling duplicate messages safely
4. **Reliability Patterns** — Retries, DLQ, publisher confirms
5. **Distributed Tracing** — Correlation IDs across services
6. **State Management** — MongoDB for job status and history

## References

- [RabbitMQ Concepts](https://www.rabbitmq.com/concepts.html)
- [Event-Driven Architecture](https://martinfowler.com/articles/201701-event-driven.html)
- [Idempotent Messaging](https://lmax-exchange.github.io/disruptor/files/Disruptor-1.0.pdf)

## Rules & Guidelines

See `AGENTS.md` for:
- Architecture rules (separate API/worker, explicit topology, MongoDB state)
- Implementation rules (consistent stack, Docker Compose, env vars, tests)
- CI/CD rules (GitHub Actions, Docker images, release tagging)
- Coding style (simple, explicit, clear names)

## TODO

See `tmp/basic-tasks.md` for the full task breakdown.
