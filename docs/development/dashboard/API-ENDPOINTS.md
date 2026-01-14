# Dashboard API Endpoints

This document defines the API endpoints required for the Klaas Dashboard.
All dashboard endpoints live under the `/dashboard` prefix.

## Authentication Endpoints

### POST /dashboard/auth/login

Authenticate a user with email and password.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "secretpassword",
  "mfaToken": "123456",      // Optional: 6-digit MFA code
  "backupCode": "ABCD1234"   // Optional: 8-char backup code
}
```

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "01HQXK7V8G3N5M2R4P6T1W9Y0Z",
      "email": "user@example.com"
    }
  }
}
```

**Response (MFA Required):**
```json
{
  "error": "MFA token required"
}
```
Status: 401

**Response (Invalid Credentials):**
```json
{
  "error": "Invalid email or password"
}
```
Status: 401

---

### GET /dashboard/auth/check

Verify if the current token is valid.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (Valid):**
```json
{
  "success": true,
  "data": {
    "userId": "01HQXK7V8G3N5M2R4P6T1W9Y0Z",
    "email": "user@example.com"
  }
}
```
Status: 200

**Response (Invalid):**
```json
{
  "error": "Invalid or expired token"
}
```
Status: 401

---

## Sessions Endpoints

All session endpoints require authentication via Bearer token.

### GET /dashboard/sessions

List all sessions for the authenticated user.

**Query Parameters:**
| Parameter | Type   | Default | Description                    |
|-----------|--------|---------|--------------------------------|
| page      | number | 1       | Page number (1-indexed)        |
| limit     | number | 20      | Items per page (max 100)       |
| search    | string | -       | Search by device name or cwd   |
| status    | string | -       | Filter by status               |
| sort      | string | last_activity_at | Sort field           |
| order     | string | desc    | Sort order (asc/desc)          |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "01HQXK7V8G3N5M2R4P6T1W9Y0Z",
      "deviceName": "MacBook Pro",
      "deviceType": "cli",
      "status": "active",
      "cwd": "/Users/user/projects/myapp",
      "lastActivityAt": "2024-01-15T10:30:00Z",
      "createdAt": "2024-01-15T09:00:00Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 5,
    "totalPages": 1
  }
}
```

---

### GET /dashboard/sessions/:id

Get details for a specific session.

**Path Parameters:**
| Parameter | Type   | Description        |
|-----------|--------|--------------------|
| id        | string | Session ULID       |

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "01HQXK7V8G3N5M2R4P6T1W9Y0Z",
    "deviceName": "MacBook Pro",
    "deviceType": "cli",
    "status": "active",
    "cwd": "/Users/user/projects/myapp",
    "lastActivityAt": "2024-01-15T10:30:00Z",
    "createdAt": "2024-01-15T09:00:00Z"
  }
}
```

**Response (Not Found):**
```json
{
  "error": "Session not found"
}
```
Status: 404

---

### DELETE /dashboard/sessions/:id

End/disconnect a session.

**Path Parameters:**
| Parameter | Type   | Description        |
|-----------|--------|--------------------|
| id        | string | Session ULID       |

**Response:**
```json
{
  "success": true
}
```

---

### WebSocket /dashboard/sessions/:id/terminal

Real-time terminal connection for a session.

**Query Parameters:**
| Parameter | Type   | Description                    |
|-----------|--------|--------------------------------|
| token     | string | JWT authentication token       |

**Connection URL:**
```
wss://api.klaas.sh/dashboard/sessions/01HQXK7V8G3N5M2R4P6T1W9Y0Z/terminal?token=eyJhbG...
```

**Message Types (Client to Server):**

```typescript
// Send input to the CLI session
{
  "type": "input",
  "content": "ls -la\n"
}

// Notify terminal resize
{
  "type": "resize",
  "cols": 120,
  "rows": 40
}
```

**Message Types (Server to Client):**

```typescript
// Terminal output from CLI
{
  "type": "output",
  "content": "total 48\ndrwxr-xr-x  12 user  staff   384 Jan 15 10:30 .\n"
}

// Clear terminal
{
  "type": "clear"
}

// CLI connected
{
  "type": "connected",
  "source": "cli"
}

// CLI disconnected
{
  "type": "disconnected",
  "source": "cli"
}
```

---

## Error Response Format

All error responses follow this format:

```json
{
  "success": false,
  "error": "Error message describing what went wrong"
}
```

### HTTP Status Codes

| Code | Description                                    |
|------|------------------------------------------------|
| 200  | Success                                        |
| 400  | Bad request (validation error)                 |
| 401  | Unauthorized (missing or invalid token)        |
| 403  | Forbidden (valid token but no permission)      |
| 404  | Not found                                      |
| 500  | Internal server error                          |

---

## Implementation Notes

### Database Schema

The sessions table should have these columns:

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT,
  device_type TEXT DEFAULT 'cli',
  status TEXT DEFAULT 'active',
  cwd TEXT,
  last_activity_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_last_activity ON sessions(last_activity_at);
```

### Session Status Values

| Status       | Description                                  |
|--------------|----------------------------------------------|
| active       | Session is connected and actively used       |
| idle         | Session is connected but no recent activity  |
| disconnected | Session has been disconnected                |

### WebSocket Implementation

The WebSocket terminal connection is handled by the SessionHub Durable Object:

1. Dashboard connects with user token
2. Token is verified, connection is authenticated
3. Connection joins the session room
4. Messages are relayed between dashboard and CLI
5. On disconnect, other parties are notified

### Rate Limiting

Apply rate limiting to these endpoints:
- POST /dashboard/auth/login: 5 requests per minute
- GET /dashboard/sessions: 60 requests per minute
- WebSocket connections: 10 connections per user

### Caching

- GET /dashboard/sessions can be cached for 5 seconds
- GET /dashboard/sessions/:id can be cached for 5 seconds
- Invalidate cache on session status changes

---

## Routes Registration

Add dashboard routes to the API:

```typescript
// packages/api/src/routes/dashboard/index.ts
import { Hono } from 'hono'
import { authRoutes } from './auth'
import { sessionsRoutes } from './sessions'

const dashboardRoutes = new Hono()

dashboardRoutes.route('/auth', authRoutes)
dashboardRoutes.route('/sessions', sessionsRoutes)

export { dashboardRoutes }
```

```typescript
// packages/api/src/app.ts
import { dashboardRoutes } from './routes/dashboard'

// ... existing routes ...
app.route('/dashboard', dashboardRoutes)
```

---

## Security Considerations

1. **Token Validation**: Always verify JWT on every request
2. **User Isolation**: Users can only access their own sessions
3. **WebSocket Auth**: Validate token before accepting WebSocket connection
4. **Input Sanitization**: Sanitize terminal input to prevent injection
5. **Rate Limiting**: Prevent abuse with appropriate rate limits
6. **CORS**: Only allow requests from dashboard origin
