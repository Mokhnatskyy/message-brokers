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
- Shared TypeScript types
- Basic API and worker skeletons
- Environment config template

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

### Install Dependencies

```bash
# API service
cd api && npm install && cd ..

# Worker service
cd worker && npm install && cd ..
```

### Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Default values:
- RABBITMQ_URL: `amqp://guest:guest@localhost:5672`
- MONGODB_URI: `mongodb://localhost:27017/message_brokers`
- PORT: `3000`

### Run Locally

**API Service:**

```bash
cd api
npm run dev
```

Open http://localhost:3000 — should show the API root endpoint and `/health` check.

**Worker Service:**

```bash
cd worker
npm run dev
```

The worker logs startup messages and waits for messages.

## Next Milestone

**Milestone 2: Local Infrastructure**
- Add Docker Compose for RabbitMQ and MongoDB
- Add API and worker containers
- Add health checks and readiness probes
- Document topology and queue setup

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
