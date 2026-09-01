# TOCA Message Brokers - Basic Task Plan

Status: planning first. Do not implement code until this plan is reviewed.

## Goal

Build an async processing platform to learn RabbitMQ, messaging patterns, Docker, CI/CD, and MongoDB through an event-driven architecture.

## Architecture Blocks

### 1. Event-Driven Architecture

- Define the first business flow as `job.created -> job.processing -> job.completed | job.failed`.
- Use clear event envelopes with `eventId`, `eventType`, `correlationId`, `causationId`, `occurredAt`, `version`, and `payload`.
- Use routing keys that describe domain events, for example `job.created`, `job.completed`, and `job.failed`.
- Keep command-style API actions separate from event names.
- Add idempotency to every consumer before adding retry behavior.

### 2. RabbitMQ

- Run RabbitMQ locally through Docker Compose with the management UI enabled.
- Create a topic exchange for job events.
- Use quorum queues for durable processing.
- Configure consumer prefetch to control worker load.
- Enable publisher confirms for reliable publishing.
- Add retry queues using TTL plus dead-letter exchanges.
- Add a final DLQ for messages that cannot be processed.
- Document queue, exchange, binding, and routing-key names.

### 3. MongoDB

- Run MongoDB locally through Docker Compose.
- Store job records with status history.
- Store idempotency keys for consumed messages.
- Add an outbox collection for reliable event publishing.
- Add indexes for job status, event id, idempotency key, and created date.
- Keep Mongo writes and event intent in the same application transaction where possible.

### 4. Docker

- Add Dockerfiles for API and worker services.
- Add Docker Compose services for API, worker, RabbitMQ, and MongoDB.
- Add health checks for RabbitMQ, MongoDB, API, and worker readiness.
- Use `.env.example` for local configuration.
- Keep container logs readable for learning and debugging message flow.

### 5. CI/CD

- Add GitHub Actions workflow for linting and tests.
- Build Docker images in CI.
- Tag images on releases.
- Add integration tests that start RabbitMQ and MongoDB services.
- Fail CI on broken tests, formatting errors, or Docker build failures.

## Suggested Milestones

### Milestone 1 - Project Skeleton

- Choose runtime and framework.
- Create API service skeleton.
- Create worker service skeleton.
- Add shared event contracts.
- Add basic local config and README instructions.

### Milestone 2 - Local Infrastructure

- Add Docker Compose.
- Add RabbitMQ service with management UI.
- Add MongoDB service.
- Add API and worker containers.
- Add health checks and startup documentation.

### Milestone 3 - First Message Flow

- API accepts a create-job request.
- API stores job in MongoDB.
- API publishes `job.created`.
- Worker consumes `job.created`.
- Worker updates job status to completed or failed.

### Milestone 4 - Reliability Patterns

- Add publisher confirms.
- Add consumer idempotency.
- Add retry exchange and retry queue.
- Add dead-letter exchange and DLQ.
- Add outbox pattern for reliable publishing.

### Milestone 5 - CI and Quality

- Add unit tests.
- Add integration tests with RabbitMQ and MongoDB.
- Add GitHub Actions.
- Add Docker image build.
- Add release tagging workflow.

## First Basic Tasks

- [ ] Confirm language and framework.
- [ ] Confirm first job domain example.
- [ ] Create project skeleton.
- [ ] Add Docker Compose infrastructure.
- [ ] Add RabbitMQ topology setup.
- [ ] Add MongoDB job store.
- [ ] Add first API-to-worker event flow.
- [ ] Add retry and DLQ behavior.
- [ ] Add CI workflow.
- [ ] Update README with learning notes and run commands.

## Open Decisions

- Runtime: Node.js/TypeScript, Java/Kotlin, Python, or another stack.
- API framework.
- Worker framework.
- Message schema validation approach.
- Whether to use RabbitMQ topology declared by code, startup script, or definitions file.
- Whether the outbox publisher runs inside API, worker, or a separate service.
