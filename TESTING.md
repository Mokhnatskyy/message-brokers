# Event-Driven Architecture Testing Guide

This guide walks through testing the complete event-driven architecture covering all Milestone 4 reliability patterns.

## Table of Contents

1. [Setup](#setup)
2. [Test 1: Basic Message Flow](#test-1-basic-message-flow)
3. [Test 2: Publisher Confirms](#test-2-publisher-confirms)
4. [Test 3: Consumer Idempotency](#test-3-consumer-idempotency)
5. [Test 4: Retry Queue](#test-4-retry-queue)
6. [Test 5: Dead-Letter Queue (DLQ)](#test-5-dead-letter-queue-dlq)
7. [Test 6: Outbox Pattern](#test-6-outbox-pattern)
8. [Monitoring & Debugging](#monitoring--debugging)

---

## Setup

### Prerequisites
- Docker and Docker Compose installed
- `curl` or Postman for API testing
- MongoDB client (optional, for DB inspection)

### Start Services

```bash
# Navigate to project
cd /Users/admin/Documents/TOCA/message-brokers

# Clean slate
docker-compose down -v

# Start all services
docker-compose up
```

**Services that start:**
- API: http://localhost:3000
- RabbitMQ: http://localhost:15672 (guest:guest)
- MongoDB: localhost:27017 (admin:admin)
- Worker: listening on RabbitMQ

**Wait for healthy status:**
```bash
docker-compose ps
# STATUS should show "healthy" for all services
```

---

## Test 1: Basic Message Flow

### Objective
Verify end-to-end message flow from API → RabbitMQ → Worker → MongoDB

### Steps

**Step 1: Create a job via API**
```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Process payment",
    "description": "Credit card transaction $99.99"
  }'
```

**Expected Response:**
```json
{
  "jobId": "1704067200000-abc12345",
  "title": "Process payment",
  "description": "Credit card transaction $99.99",
  "status": "created",
  "eventId": "1704067200001-def67890",
  "correlationId": "1704067200002-ghi24680"
}
```

**Step 2: Check API logs**
```bash
docker-compose logs api | tail -20
```

**Expected logs:**
```
Storing event in outbox: 1704067200001-def67890
Event published: job.created
Event published and marked in outbox: 1704067200001-def67890
```

**Step 3: Check worker logs**
```bash
docker-compose logs worker | tail -20
```

**Expected logs:**
```
Message received (1): {"eventId":"...", "eventType":"job.created", ...}
Processing job 1704067200000-abc12345: "Process payment"
⏳ Working on job...
✓ Job 1704067200000-abc12345 completed
Message acknowledged
```

**Step 4: Verify job in MongoDB**
```bash
# Connect to MongoDB
mongo "mongodb://admin:admin@localhost:27017/message_brokers?authSource=admin"

# Query jobs collection
db.jobs.findOne({ jobId: "1704067200000-abc12345" })
```

**Expected output:**
```javascript
{
  _id: ObjectId("..."),
  jobId: "1704067200000-abc12345",
  title: "Process payment",
  status: "completed",
  events: [
    { eventType: "job.created", timestamp: ISODate(...) },
    { eventType: "job.completed", timestamp: ISODate(...), result: {...} }
  ]
}
```

**Step 5: Get job via API**
```bash
curl http://localhost:3000/jobs/1704067200000-abc12345
```

---

## Test 2: Publisher Confirms

### Objective
Verify that the API waits for RabbitMQ to confirm message receipt before returning success

### Explanation
**Publisher Confirms** is a RabbitMQ feature where:
1. API publishes message with `persistent: true`
2. Channel has `confirmSelect()` enabled
3. RabbitMQ sends back a confirmation once message is persisted
4. API's `channel.on("confirm")` event fires
5. Only then does the API return success to the client

This ensures the API never tells the client "done" if RabbitMQ hasn't safely stored the message.

### Steps

**Step 1: Watch API logs for confirms**
```bash
docker-compose logs -f api | grep "Publisher confirm"
```

**Step 2: Create a job**
```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"title":"Confirm test"}'
```

**Step 3: Expected log output**
```
Publisher confirms enabled
✓ Publisher confirm received (tag: 1)
Event published: job.created
✓ Publisher confirm received (tag: 2)
Event published: job.completed
```

**What this means:**
- Each message gets a delivery tag (1, 2, 3...)
- RabbitMQ confirms each one
- If API crashes, unconfirmed messages won't be lost (they stay in publisher's memory)

---

## Test 3: Consumer Idempotency

### Objective
Verify that processing the same event twice doesn't result in duplicate work

### Explanation
**Idempotency** means an operation produces the same result no matter how many times it's executed.

**How it works:**
1. When worker processes `event.eventId`, it stores it in `idempotency` collection
2. If the same `eventId` arrives again, worker checks `idempotency` first
3. If found, worker skips processing and returns success
4. This prevents duplicate job status updates if a message is redelivered

### Steps

**Step 1: Get a job ID from a previous test**
```bash
# From Test 1, you have a jobId like: 1704067200000-abc12345
export JOBID="1704067200000-abc12345"
```

**Step 2: Manually publish same event twice to test idempotency**

First, let's create a new job and get its event ID:
```bash
RESPONSE=$(curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"title":"Idempotency test"}')

EVENT_ID=$(echo $RESPONSE | grep -o '"eventId":"[^"]*"' | cut -d'"' -f4)
echo "Event ID: $EVENT_ID"
```

**Step 3: Check MongoDB idempotency collection**
```bash
mongo "mongodb://admin:admin@localhost:27017/message_brokers?authSource=admin"

db.idempotency.findOne({ eventId: "YOUR_EVENT_ID" })
```

**Expected output (first time):**
```javascript
{
  _id: ObjectId("..."),
  eventId: "1704067200003-xyz99999",
  eventType: "job.created",
  processedAt: ISODate("..."),
  workerProcessed: true
}
```

**Step 4: Check worker logs**
```bash
docker-compose logs worker | grep "idempotency\|Event already processed"
```

**Step 5: RabbitMQ will requeue on worker crash - test by:**
1. Stop worker: `docker-compose stop worker`
2. Wait a few seconds
3. Restart worker: `docker-compose start worker`
4. Watch logs - worker should skip the same event if it was already processed

---

## Test 4: Retry Queue

### Objective
Verify that failed messages are automatically retried

### Explanation
**Retry Logic:**
1. Worker throws error processing message
2. Worker does `channel.nack(msg, false, true)` - negative acknowledge + requeue
3. Message goes to retry queue (configured in worker rabbitmq.js)
4. Retry queue has 5-second TTL
5. After 5 seconds, message expires and returns to main queue
6. Worker processes again

### Steps

**Step 1: Enable simulated failures in worker**

Edit `worker/src/index.js` line ~54:
```javascript
// Uncomment this line:
if (Math.random() < 0.3) throw new Error("Simulated processing error");
```

**Step 2: Restart worker**
```bash
docker-compose restart worker
```

**Step 3: Create multiple jobs to trigger failures**
```bash
for i in {1..5}; do
  curl -X POST http://localhost:3000/jobs \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"Job $i\"}"
  sleep 1
done
```

**Step 4: Watch worker logs for retries**
```bash
docker-compose logs -f worker
```

**Expected output:**
```
Processing job ...: "Job 1"
⏳ Working on job...
✗ Error processing job: Simulated processing error
Message nacked and requeued
[5 seconds later...]
Message received (1): {"eventId":"...", "eventType":"job.created", ...}
Processing job ...: "Job 1"
⏳ Working on job...
✓ Job ... completed
```

**Step 5: Check RabbitMQ UI for queues**
- Go to http://localhost:15672 (guest:guest)
- Click "Queues and Streams"
- You should see:
  - `job.created` - main queue
  - `job.created.retry` - retry queue (may show messages if TTL is still active)

**Step 6: Verify job eventually completes in MongoDB**
```bash
mongo "mongodb://admin:admin@localhost:27017/message_brokers?authSource=admin"

db.jobs.findOne({ title: "Job 1" })
# Should show status: "completed" even after initial failure
```

---

## Test 5: Dead-Letter Queue (DLQ)

### Objective
Verify that messages that fail multiple times go to DLQ

### Explanation
**DLQ Flow:**
1. Message fails processing
2. Goes to retry queue
3. Retry queue has 5-second TTL
4. After TTL, message is "dead-lettered" to DLQ exchange
5. DLQ stores message for 24 hours for debugging
6. Ops team can inspect and manually retry

### Steps

**Step 1: Make failures permanent (worker can't recover)**

Edit `worker/src/index.js`:
```javascript
// Always fail:
throw new Error("Permanent failure - testing DLQ");
```

**Step 2: Restart worker and create jobs**
```bash
docker-compose restart worker

curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"title":"DLQ test"}'
```

**Step 3: Watch worker logs**
```bash
docker-compose logs -f worker
```

**You'll see:**
```
Processing job ...: "DLQ test"
✗ Error processing job: Permanent failure - testing DLQ
Message nacked and requeued
[5 seconds later - retry from retry queue...]
Processing job ...: "DLQ test"
✗ Error processing job: Permanent failure - testing DLQ
Message nacked and requeued
[5 seconds later - TTL expires on retry queue...]
Message appears in DLQ
```

**Step 4: Check RabbitMQ UI for DLQ**
- Go to http://localhost:15672
- Click "Queues and Streams"
- Look for `job.created.dlq` queue
- Click on it to view messages
- Each message shows payload for debugging

**Step 5: In MongoDB, check job status**
```bash
db.jobs.findOne({ title: "DLQ test" })
# status: "failed"
```

**Step 6: Fix the worker code**

Remove the permanent error:
```javascript
// Remove or comment out the throw
// throw new Error("Permanent failure - testing DLQ");
```

Restart:
```bash
docker-compose restart worker
```

---

## Test 6: Outbox Pattern

### Objective
Verify that events are safely stored before publishing and republished if RabbitMQ is unavailable

### Explanation
**Outbox Pattern:**
1. Event is stored in `outbox` collection first (`published: false`)
2. Then published to RabbitMQ
3. On successful publish, marked as published in outbox (`published: true`)
4. If RabbitMQ is down, event stays in outbox
5. Background service (`outbox-publisher.js`) runs every 5s
6. It finds unpublished events and republishes them
7. Old published events cleaned up after 24 hours

### Steps

**Step 1: Watch outbox in MongoDB**
```bash
mongo "mongodb://admin:admin@localhost:27017/message_brokers?authSource=admin"

# Terminal 1: Watch unpublished events
db.outbox.find({ published: false }).watch()
```

**Terminal 2: Create a job**
```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"title":"Outbox test"}'
```

**Expected output in Terminal 1:**
```javascript
{
  _id: ObjectId("..."),
  eventId: "...",
  routingKey: "job.created",
  eventEnvelope: { /* full event */ },
  published: false,
  createdAt: ISODate("..."),
  publishedAt: null
}
// Then immediately updates to:
// published: true,
// publishedAt: ISODate("...")
```

**Step 2: Stop RabbitMQ to test outbox republishing**
```bash
docker-compose stop rabbitmq
```

**Step 3: Create a job (will fail to publish, but stored in outbox)**
```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"title":"RabbitMQ down"}'
```

**Expected API response:**
```
Failed to publish event ..., will retry from outbox
```

**Step 4: Check outbox - should have unpublished event**
```bash
db.outbox.findOne({ published: false })
# Should find the event we just created
```

**Step 5: Restart RabbitMQ**
```bash
docker-compose start rabbitmq

# Wait for it to be healthy
docker-compose ps
```

**Step 6: Watch API logs for outbox publisher**
```bash
docker-compose logs -f api | grep -i outbox
```

**Expected output (within 5 seconds):**
```
Outbox: Found 1 unpublished events
Outbox: Publishing event ...
Event published: job.created
Outbox: Event ... published successfully
```

**Step 7: Check outbox - event now published**
```bash
db.outbox.find({ published: true })
# Should see the event is now marked published
```

**Step 8: Check worker consumed it**
```bash
docker-compose logs worker | tail -20
# Should show job was processed
```

---

## Monitoring & Debugging

### Real-Time Monitoring

**Watch all logs:**
```bash
docker-compose logs -f
```

**Watch specific service:**
```bash
docker-compose logs -f api
docker-compose logs -f worker
docker-compose logs -f rabbitmq
```

**Watch specific keyword:**
```bash
docker-compose logs -f | grep -i "error\|fail\|confirm\|outbox"
```

### MongoDB Inspection

**Connect to MongoDB:**
```bash
mongo "mongodb://admin:admin@localhost:27017/message_brokers?authSource=admin"
```

**View all collections:**
```javascript
db.getCollectionNames()
// ["jobs", "idempotency", "outbox"]
```

**Check jobs:**
```javascript
db.jobs.find().pretty()
db.jobs.findOne({ status: "completed" })
db.jobs.findOne({ status: "failed" })
```

**Check idempotency:**
```javascript
db.idempotency.find().pretty()
db.idempotency.countDocuments() // Should equal number of processed events
```

**Check outbox:**
```javascript
db.outbox.find({ published: false }).pretty() // Unpublished
db.outbox.find({ published: true }).count() // Published
```

### RabbitMQ Management UI

**Access:** http://localhost:15672 (guest:guest)

**View Exchanges:**
- `job-events` - main topic exchange
- `job-events-retry` - retry exchange
- `job-events-dlq` - dead-letter exchange

**View Queues:**
- `job.created` - messages being processed
- `job.created.retry` - messages in retry (temporary)
- `job.created.dlq` - failed messages (24h retention)

**View Bindings:**
- job.created → job-events exchange (routing key: job.created)
- job.created.retry → job-events-retry exchange
- job.created.dlq → job-events-dlq exchange

### Common Issues & Fixes

**Issue: API can't connect to MongoDB**
```
Failed to connect to MongoDB: AuthenticationError
```
**Fix:**
- Check docker-compose.yml has correct credentials (admin:admin)
- Ensure `?authSource=admin` in connection string
- Restart MongoDB: `docker-compose restart mongodb`

**Issue: Worker not consuming messages**
```
RabbitMQ connection failed
```
**Fix:**
- Check RabbitMQ is healthy: `docker-compose ps`
- Restart RabbitMQ: `docker-compose restart rabbitmq`
- Check worker logs: `docker-compose logs worker`

**Issue: No publisher confirms in logs**
```
Publisher confirm received: (no output)
```
**Fix:**
- This is normal - confirmSelect is async
- Check actual confirms in API logs with: `docker-compose logs api | grep "confirm"`

**Issue: Messages not being retried**
```
Message appears once, never retries
```
**Fix:**
- Check retry queue exists: RabbitMQ UI → Queues
- Verify TTL is set: `x-message-ttl: 5000`
- Restart worker: `docker-compose restart worker`

---

## Complete Test Checklist

- [ ] Test 1: Basic Message Flow
  - [ ] API accepts POST /jobs
  - [ ] RabbitMQ receives event
  - [ ] Worker processes event
  - [ ] MongoDB stores job
  - [ ] Job status is "completed"

- [ ] Test 2: Publisher Confirms
  - [ ] API logs show "Publisher confirm received"
  - [ ] API returns success only after confirm

- [ ] Test 3: Consumer Idempotency
  - [ ] idempotency collection has eventId
  - [ ] Duplicate events are skipped
  - [ ] No duplicate job status updates

- [ ] Test 4: Retry Queue
  - [ ] Failed messages logged
  - [ ] Message appears in retry queue
  - [ ] After 5s, message retried from main queue
  - [ ] Eventually completes after retry

- [ ] Test 5: DLQ
  - [ ] Permanent failures go to DLQ queue
  - [ ] RabbitMQ UI shows job.created.dlq
  - [ ] Messages retained 24 hours
  - [ ] job status shows "failed"

- [ ] Test 6: Outbox Pattern
  - [ ] outbox collection stores events
  - [ ] Events marked published after RabbitMQ ack
  - [ ] Unpublished events republished on restart
  - [ ] Old published events cleaned up

---

## Success Criteria

All 5 reliability patterns working together:
1. ✅ Publisher confirms message safely stored in RabbitMQ
2. ✅ Consumer idempotency prevents duplicate processing
3. ✅ Retry queue handles transient failures
4. ✅ DLQ captures permanently failed messages
5. ✅ Outbox pattern ensures no events are lost

**The system is production-ready when all 6 tests pass!**
