-- =============================================================================
-- Support Tickets System - Core Tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table: support_tickets
-- Purpose: Stores ticket metadata and status
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,                    -- ULID
  user_id TEXT NOT NULL,                  -- FK to users table
  subject TEXT NOT NULL,                  -- Max 200 chars, enforced in API
  status TEXT NOT NULL DEFAULT 'open',    -- 'open', 'resolved'

  -- Timestamps (ISO 8601 format)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,                       -- When status changed to 'resolved'

  -- Read tracking aggregates (denormalized for performance)
  has_unread_user_messages INTEGER DEFAULT 0,   -- For admin view
  has_unread_admin_messages INTEGER DEFAULT 0,  -- For user view
  last_user_message_at TEXT,              -- For admin sorting/filtering
  last_admin_message_at TEXT,             -- For user awareness

  -- Future extensibility
  source TEXT DEFAULT 'dashboard',        -- 'dashboard', 'email', 'api'
  metadata TEXT,                          -- JSON blob for future fields

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id
  ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status
  ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_updated_at
  ON support_tickets(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at
  ON support_tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_has_unread_user
  ON support_tickets(has_unread_user_messages)
  WHERE has_unread_user_messages = 1;

-- -----------------------------------------------------------------------------
-- Table: support_messages
-- Purpose: Stores all messages in ticket threads
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_messages (
  id TEXT PRIMARY KEY,                    -- ULID
  ticket_id TEXT NOT NULL,                -- FK to support_tickets

  -- Sender information
  sender_type TEXT NOT NULL,              -- 'user', 'admin', 'system'
  sender_id TEXT NOT NULL,                -- User or Admin ULID

  -- Message content
  body TEXT NOT NULL,                     -- Max 5000 chars, enforced in API
  is_internal INTEGER DEFAULT 0,          -- 1 = admin-only note

  -- Read tracking
  is_read INTEGER DEFAULT 0,              -- Has recipient read this?
  read_at TEXT,                           -- When it was read (ISO 8601)
  read_by TEXT,                           -- Who marked it as read (for audit)

  -- Timestamps
  created_at TEXT NOT NULL,

  -- Future extensibility
  message_type TEXT DEFAULT 'text',       -- 'text', 'attachment', 'system_event'
  metadata TEXT,                          -- JSON blob for attachments, etc.

  FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_id
  ON support_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_created_at
  ON support_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_support_messages_sender_type
  ON support_messages(sender_type);
CREATE INDEX IF NOT EXISTS idx_support_messages_unread
  ON support_messages(is_read) WHERE is_read = 0;

-- -----------------------------------------------------------------------------
-- Table: support_ticket_events
-- Purpose: Audit log for ticket status changes and actions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_ticket_events (
  id TEXT PRIMARY KEY,                    -- ULID
  ticket_id TEXT NOT NULL,                -- FK to support_tickets

  -- Event details
  event_type TEXT NOT NULL,               -- 'created', 'status_changed', etc.
  actor_type TEXT NOT NULL,               -- 'user', 'admin', 'system'
  actor_id TEXT,                          -- Who triggered the event

  -- Change tracking
  old_value TEXT,                         -- Previous value
  new_value TEXT,                         -- New value

  -- Timestamps
  created_at TEXT NOT NULL,

  FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_events_ticket_id
  ON support_ticket_events(ticket_id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_events_created_at
  ON support_ticket_events(created_at);
