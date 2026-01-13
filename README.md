# Google Drive Sync Service

A resumable, rate-limit-safe synchronization service that ingests file metadata from Google Drive into a local SQLite store, with a job system that survives restarts and partial failures.

## Overview

This service connects to the Google Drive API and synchronizes file metadata to a local database. It's designed to handle large volumes of files with:

- Automatic pagination handling
- Rate limit awareness with exponential backoff
- Checkpoint-based resume capability
- Job queue with retries and dead-letter handling

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        HTTP API (Express)                       │
│  /auth  │  /sync  │  /jobs  │  /files                           │
└────┬────┴────┬────┴────┬────┴────┬──────────────────────────────┘
     │         │         │         │
     ▼         ▼         ▼         ▼
┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
│  Auth   │ │  Sync    │ │   Job    │ │    File      │
│ Client  │ │  Engine  │ │  Runner  │ │  Repository  │
└────┬────┘ └────┬─────┘ └────┬─────┘ └──────────────┘
     │           │            │
     ▼           ▼            ▼
┌─────────┐ ┌──────────┐ ┌──────────────────────────────┐
│ Google  │ │Checkpoint│ │         SQLite               │
│ Drive   │ │   Repo   │ │ files | jobs | checkpoints   │
│  API    │ └──────────┘ └──────────────────────────────┘
└─────────┘
```

### Components

1. **API Client Layer** (`src/api/`)
   - `GoogleAuthClient`: Handles OAuth 2.0 flow and token management
   - `DriveClient`: Thin wrapper around Google Drive API with retry logic

2. **Sync Engine** (`src/sync/`)
   - Orchestrates sync operations
   - Manages checkpoints for resumability
   - Supports full and incremental syncs

3. **Job System** (`src/jobs/`)
   - `JobRunner`: Processes jobs with configurable concurrency
   - Exponential backoff on failures
   - Dead-letter queue for permanently failed jobs

4. **Persistence Layer** (`src/persistence/`)
   - SQLite-based storage with WAL mode
   - Repositories for files, jobs, checkpoints, tokens

## Setup

### Prerequisites

- Node.js 18+
- Google Cloud project with Drive API enabled
- OAuth 2.0 credentials (Desktop application type)

### Installation

```bash
npm install
```

### Configuration

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Configure your Google OAuth credentials:
```
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
```

3. Optional settings:
```
PORT=3000
SYNC_CONCURRENCY=3
SYNC_PAGE_SIZE=100
MAX_RETRIES=5
```

### Running the Service

```bash
# Development mode with auto-reload
npm run dev

# Production
npm start
```

## API Reference

### Health

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Application health, auth status, job runner stats |

### Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/login` | GET | Initiates OAuth flow (redirects to Google) |
| `/auth/callback` | GET | OAuth callback handler |
| `/auth/status` | GET | Check authentication status |
| `/auth/logout` | POST | Revoke access and clear tokens |

### Sync Operations

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/sync/full` | POST | Start a full sync of all files |
| `/sync/incremental` | POST | Sync only changed files |
| `/sync/current` | GET | Get currently running sync status |
| `/sync/:syncId/status` | GET | Get sync status by ID |
| `/sync/:syncId/pause` | POST | Pause a running sync |
| `/sync/:syncId/resume` | POST | Resume a paused sync |
| `/sync/:syncId` | DELETE | Delete a sync record (must not be in progress) |
| `/sync/history` | GET | List past sync operations (`?limit=N`) |

### Job Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/jobs/stats` | GET | Job queue statistics |
| `/jobs/active` | GET | Currently running jobs |
| `/jobs/pending` | GET | Pending jobs in queue (`?limit=N`) |
| `/jobs/completed` | GET | Completed jobs (`?limit=N`) |
| `/jobs/failed` | GET | Failed jobs (`?limit=N`) |
| `/jobs/dead-letter` | GET | Jobs in dead-letter queue (`?limit=N`) |
| `/jobs/:id` | GET | Get job details by ID |
| `/jobs/:id/retry` | POST | Retry a failed job |
| `/jobs/dead-letter/:id/retry` | POST | Retry a dead-letter job |
| `/jobs/runner/pause` | POST | Pause job processing |
| `/jobs/runner/resume` | POST | Resume job processing |
| `/jobs/runner/concurrency` | POST | Set job concurrency (`{"concurrency": N}`) |

### Files

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/files` | GET | List synced files (`?limit=N&offset=N`) |
| `/files/count` | GET | Total file count |
| `/files/:id` | GET | Get file details by Google Drive ID |
| `/files/:id/children` | GET | List children of a folder |

## Reliability Strategy

### Resumable Syncs

The sync engine persists progress checkpoints after each page of results:

1. On start, checks for existing in-progress sync
2. If found, resumes from last saved page token
3. Checkpoints include: page token, files processed, timestamp

This ensures a sync can be interrupted (server restart, network failure) and resume without re-processing already synced files.

### Rate Limit Handling

Google Drive API has usage quotas. The DriveClient handles this with:

- Request throttling (minimum 100ms between requests)
- Automatic retry on 429 responses
- Exponential backoff with jitter
- Parsing of `Retry-After` headers when available

### Job Retries

Failed jobs follow this lifecycle:

```
PENDING → RUNNING → COMPLETED
                  ↓
               FAILED (retries remaining)
                  ↓
               PENDING (rescheduled with backoff)
                  ↓
               DEAD (max retries exceeded)
```

Jobs in the dead-letter queue can be manually retried via the API.

### Data Consistency

- All file upserts are idempotent (keyed by Google Drive file ID)
- Batch operations use SQLite transactions
- WAL mode prevents corruption on crashes
- Checkpoint updates are atomic with file inserts

## Running Tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# With coverage report
npm test -- --coverage
```

## Testing the Service Manually

A Postman collection (`postman_collection.json`) is included for easy API testing. Import it into Postman and set the `baseUrl` variable to `http://localhost:3000`.

### Step-by-Step Testing Guide

#### 1. Start the Service

```bash
npm run dev
```

#### 2. Verify Service Health

```bash
curl http://localhost:3000/health
```

This returns the application health status, authentication state, and job runner statistics.

#### 3. Authenticate with Google

Open in your browser (this initiates the OAuth flow):
```
http://localhost:3000/auth/login
```

After completing Google authentication, verify your auth status:
```bash
curl http://localhost:3000/auth/status
```

#### 4. Start a Sync

Start a full sync of all Google Drive files:
```bash
curl -X POST http://localhost:3000/sync/full
```

Or start an incremental sync (only changes since last sync):
```bash
curl -X POST http://localhost:3000/sync/incremental
```

Both return a `syncId` that you can use to track progress.

#### 5. Monitor Sync Progress

Check current running sync:
```bash
curl http://localhost:3000/sync/current
```

Check status of a specific sync:
```bash
curl http://localhost:3000/sync/{syncId}/status
```

View sync history:
```bash
curl http://localhost:3000/sync/history?limit=20
```

#### 6. Pause/Resume a Sync

```bash
# Pause
curl -X POST http://localhost:3000/sync/{syncId}/pause

# Resume
curl -X POST http://localhost:3000/sync/{syncId}/resume
```

#### 7. Delete a Sync

Delete a sync record from the database (sync must not be in progress):
```bash
curl -X DELETE http://localhost:3000/sync/{syncId}
```

Note: You cannot delete a sync that is currently in progress. Pause it first if needed.

#### 8. View Synced Files

List all synced files (paginated):
```bash
curl "http://localhost:3000/files?limit=100&offset=0"
```

Get total file count:
```bash
curl http://localhost:3000/files/count
```

Get a specific file by ID:
```bash
curl http://localhost:3000/files/{fileId}
```

Get children of a folder:
```bash
curl http://localhost:3000/files/{folderId}/children
```

#### 9. Monitor Jobs

Get job statistics:
```bash
curl http://localhost:3000/jobs/stats
```

View jobs by status:
```bash
curl http://localhost:3000/jobs/active
curl http://localhost:3000/jobs/pending?limit=50
curl http://localhost:3000/jobs/completed?limit=50
curl http://localhost:3000/jobs/failed?limit=50
curl http://localhost:3000/jobs/dead-letter?limit=50
```

Get a specific job:
```bash
curl http://localhost:3000/jobs/{jobId}
```

#### 10. Retry Failed Jobs

Retry a failed job:
```bash
curl -X POST http://localhost:3000/jobs/{jobId}/retry
```

Retry a dead-letter job:
```bash
curl -X POST http://localhost:3000/jobs/dead-letter/{jobId}/retry
```

#### 11. Control Job Runner

```bash
# Pause job processing
curl -X POST http://localhost:3000/jobs/runner/pause

# Resume job processing
curl -X POST http://localhost:3000/jobs/runner/resume

# Set concurrency (number of parallel jobs)
curl -X POST http://localhost:3000/jobs/runner/concurrency \
  -H "Content-Type: application/json" \
  -d '{"concurrency": 3}'
```

#### 12. Logout

```bash
curl -X POST http://localhost:3000/auth/logout
```

### Typical Test Workflow

1. **Happy Path**: Login → Full Sync → Monitor Progress → View Files → Logout
2. **Failure Recovery**: Start Sync → Kill Server Mid-Sync → Restart → Verify Resume
3. **Rate Limit Handling**: Start Large Sync → Observe Backoff in Logs
4. **Job Retry**: Cause a Job Failure → View in Failed Queue → Retry → Verify Completion

## Known Limitations

1. **Single user**: Currently supports one authenticated user. Multi-user support would require per-user token management.

2. **File content**: This implementation syncs metadata only. Downloading file content is stubbed but not fully implemented.

3. **Real-time sync**: Uses polling-based incremental sync. For real-time updates, you'd need to implement Drive push notifications.

4. **Memory usage**: Large syncs keep some state in memory. For very large drives (millions of files), consider streaming results.

5. **No deduplication**: Files are stored by their Drive ID. Duplicate files (same content, different IDs) are stored separately.

## Project Structure

```
src/
├── api/           # Google API clients
├── config/        # Configuration
├── jobs/          # Job runner and handlers
├── persistence/   # Database and repositories
├── routes/        # HTTP endpoints
├── sync/          # Sync engine
├── utils/         # Logger, helpers
├── app.js         # Application setup
└── index.js       # Entry point

tests/
├── unit/          # Unit tests
├── integration/   # Integration tests
└── setup.js       # Test configuration
```