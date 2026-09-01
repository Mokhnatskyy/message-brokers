# Project Rules

These rules guide Codex work in this repository.

## Project Direction

- The project is a learning-focused async processing platform for RabbitMQ and messaging patterns.
- Prefer small, understandable milestones over large framework-heavy jumps.
- Keep event-driven architecture concepts visible in the code: events, routing keys, queues, retries, DLQ, idempotency, and status tracking.
- Use the development plan in `tmp/basic-tasks.md` as the working checklist until a permanent roadmap replaces it.

## Architecture Rules

- Separate API producer behavior from worker consumer behavior.
- Keep message contracts in a shared module or clearly documented shared location.
- Every event should use a consistent envelope with ids, timestamps, type, version, and payload.
- Every consumer must be idempotent before retry or DLQ logic is considered complete.
- RabbitMQ topology must be explicit and documented: exchanges, queues, bindings, routing keys, retry queues, and DLQs.
- MongoDB should hold job state, processing history, idempotency records, and outbox records where needed.

## Implementation Rules

- Prefer the existing project stack once one is chosen; do not introduce a second framework without a clear reason.
- Keep Docker Compose useful for local learning: readable names, health checks, ports, and management UI access.
- Keep environment variables documented in `.env.example`.
- Add tests alongside meaningful behavior, especially message publishing, consumption, retry, idempotency, and Mongo persistence.
- Update the README whenever run commands, topology, or learning notes change.

## CI/CD Rules

- GitHub Actions should run linting and tests before Docker image builds.
- Docker images should be buildable locally and in CI.
- Release tags should produce tagged Docker images once the project reaches that milestone.

## Coding Style

- Keep code simple and explicit while the project is in learning mode.
- Avoid broad refactors unrelated to the current milestone.
- Prefer clear names over clever abstractions.
- Add short comments only where messaging or reliability behavior would otherwise be easy to misread.
