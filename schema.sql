-- DM Mirror Database Schema - Separation & Attribution Specification
-- Relates conversations and messages directly using the native conversation_id (TEXT)

-- Enable pg_trgm for efficient fuzzy text matching and substring searches (ILIKE %query%)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -------------------------------------------------------------
-- 1. Conversations Table
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id TEXT NOT NULL UNIQUE,      -- Instagram thread ID (primary relationship key)
    conversation_name TEXT,                    -- Display name of the conversation
    avatar_url TEXT,                           -- Profile picture URL
    last_message TEXT,                         -- Denormalized latest message preview
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- -------------------------------------------------------------
-- 2. Messages Table
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    message_hash TEXT NOT NULL UNIQUE,         -- Deterministic message hash for deduplication
    sender_name TEXT,                          -- Sender's visible name
    sender_username TEXT,                      -- Sender's Instagram username (if available)
    content TEXT,                              -- Message content
    timestamp TIMESTAMPTZ NOT NULL,            -- Native message timestamp
    sent_by_me BOOLEAN NOT NULL,               -- Outgoing message flag
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()) -- Ingestion timestamp
);

-- -------------------------------------------------------------
-- 3. Indexes & Performance Optimization
-- -------------------------------------------------------------
-- Index for ordering conversations by last activity
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at 
ON conversations (updated_at DESC);

-- Composite index for fast thread history loading (joins directly on the TEXT conversation_id)
CREATE INDEX IF NOT EXISTS idx_messages_conversation_timestamp 
ON messages (conversation_id, timestamp DESC);

-- Trigram GIN index for fast full-text substring search in message content
CREATE INDEX IF NOT EXISTS idx_messages_content_trgm 
ON messages USING gin (content gin_trgm_ops);

-- Trigram GIN index for searching conversations by name (case-insensitive substring lookup)
CREATE INDEX IF NOT EXISTS idx_conversations_name_trgm 
ON conversations USING gin (conversation_name gin_trgm_ops);

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
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE conversations
    SET 
        updated_at = NEW.timestamp,
        last_message = LEFT(NEW.content, 120)
    WHERE conversation_id = NEW.conversation_id
      AND (conversations.updated_at IS NULL OR conversations.updated_at <= NEW.timestamp);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_update_conversation_timestamp
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION update_conversation_timestamp();
