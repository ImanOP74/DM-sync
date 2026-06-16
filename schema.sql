-- DM Mirror Database Schema
-- Optimized for denormalized message preview, deduplication, fast retrieval, and message search.

-- Enable pg_trgm for efficient fuzzy text matching and substring searches (ILIKE %query%)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -------------------------------------------------------------
-- 1. Conversations Table
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id TEXT NOT NULL UNIQUE, -- Instagram Native thread ID
    username TEXT,                        -- Participant display name / username
    avatar_url TEXT,                      -- Profile picture image URL
    last_message TEXT,                    -- Denormalized latest message preview
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- -------------------------------------------------------------
-- 2. Messages Table
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    message_hash TEXT NOT NULL UNIQUE,    -- Unique deterministic hash signature
    sender_name TEXT,                     -- Name of the sender
    content TEXT,                         -- Message text content
    timestamp TIMESTAMPTZ NOT NULL,       -- Native Instagram message timestamp
    sent_by_me BOOLEAN NOT NULL,          -- Sent by user check
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()) -- Insertion timestamp
);

-- -------------------------------------------------------------
-- 3. Indexes & Performance Optimization
-- -------------------------------------------------------------
-- Index for ordering conversations by last activity
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at 
ON conversations (updated_at DESC);

-- Composite index for fast thread history loading
CREATE INDEX IF NOT EXISTS idx_messages_conversation_timestamp 
ON messages (conversation_id, timestamp DESC);

-- Trigram GIN index for fast full-text substring search in message content
CREATE INDEX IF NOT EXISTS idx_messages_content_trgm 
ON messages USING gin (content gin_trgm_ops);

-- Trigram GIN index for searching conversations by username (case-insensitive substring lookup)
CREATE INDEX IF NOT EXISTS idx_conversations_username_trgm 
ON conversations USING gin (username gin_trgm_ops);

-- -------------------------------------------------------------
-- 4. Row Level Security (RLS) - Disabled for Development
-- -------------------------------------------------------------
ALTER TABLE conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------
-- 5. Trigger: Update conversations last_message cache
-- -------------------------------------------------------------
-- This trigger function runs AFTER a message is inserted. It updates the parent
-- conversation's cache with the last message content and timestamp.
-- The condition ensures that out-of-order pagination (historical load on scroll up)
-- does not overwrite the most recent message preview.
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE conversations
    SET 
        updated_at = NEW.timestamp,
        last_message = LEFT(NEW.content, 120)
    WHERE id = NEW.conversation_id
      AND (conversations.updated_at IS NULL OR conversations.updated_at <= NEW.timestamp);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_update_conversation_timestamp
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION update_conversation_timestamp();
