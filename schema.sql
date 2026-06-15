-- Instagram DM Sync Supabase Database Schema
-- Optimized for denormalized message preview, deduplication, fast retrieval, and message search.

-- -------------------------------------------------------------
-- 1. Extensions
-- -------------------------------------------------------------
-- Enable pg_trgm for efficient fuzzy text matching and substring searches (ILIKE %query%)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -------------------------------------------------------------
-- 2. Conversations Table
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instagram_thread_id TEXT NOT NULL UNIQUE,
    name TEXT,
    is_group BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Denormalized Caching Columns (Optimizes Sidebar Queries)
    last_message_preview TEXT,
    last_message_time TIMESTAMPTZ,
    last_message_sender_id TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Add descriptions to the conversations table and columns
COMMENT ON TABLE conversations IS 'Stores synchronized Instagram conversation threads.';
COMMENT ON COLUMN conversations.id IS 'Internal unique UUID identifier.';
COMMENT ON COLUMN conversations.instagram_thread_id IS 'Unique thread identifier native to Instagram.';
COMMENT ON COLUMN conversations.name IS 'Display name of the chat.';
COMMENT ON COLUMN conversations.last_message_preview IS 'Denormalized text preview of the latest thread message.';
COMMENT ON COLUMN conversations.last_message_time IS 'Timestamp of the latest message.';
COMMENT ON COLUMN conversations.last_message_sender_id IS 'Sender ID of the latest message.';
COMMENT ON COLUMN conversations.updated_at IS 'Timestamp of the last synced message or metadata update. Used to sort chat lists.';

-- -------------------------------------------------------------
-- 3. Messages Table
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    instagram_message_id TEXT NOT NULL UNIQUE,
    sender_id TEXT NOT NULL,          -- 'me' or 'other' (stable)
    sender_username TEXT,            -- Actual username/name (display only)
    text TEXT,
    media_url TEXT,
    media_type TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL, -- Instagram native message creation timestamp
    synced_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Add descriptions to the messages table and columns
COMMENT ON TABLE messages IS 'Stores individual synchronized messages.';
COMMENT ON COLUMN messages.sender_id IS 'Unique ID representing sender: me or other (stable for deduplication)';
COMMENT ON COLUMN messages.sender_username IS 'The display name or username of the sender at the time of sync';

-- -------------------------------------------------------------
-- 4. Optimizations: Indexes
-- -------------------------------------------------------------

-- Index for ordering conversations by last activity (highly active sidebar query)
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at 
ON conversations (updated_at DESC);

-- Composite index for fast thread history loading (fetching last N messages of a conversation)
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at 
ON messages (conversation_id, created_at DESC);

-- Trigram GIN index for fast full-text substring search in message text
CREATE INDEX IF NOT EXISTS idx_messages_text_trgm 
ON messages USING gin (text gin_trgm_ops);

-- Trigram GIN index for searching messages by sender username (case-insensitive substring lookup)
CREATE INDEX IF NOT EXISTS idx_messages_sender_username_trgm 
ON messages USING gin (sender_username gin_trgm_ops);

-- -------------------------------------------------------------
-- 5. Row Level Security (RLS) - Disabled for Development
-- -------------------------------------------------------------
ALTER TABLE conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------
-- 6. Trigger: Update conversations last_message cache
-- -------------------------------------------------------------
-- This trigger function runs AFTER a message is inserted. It updates the parent
-- conversation's cache with the last message preview, sender, and time.
-- The condition ensures that out-of-order pagination (historical load on scroll up)
-- does not overwrite the most recent message preview.
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE conversations
    SET 
        updated_at = NEW.created_at,
        last_message_preview = LEFT(NEW.text, 120),
        last_message_time = NEW.created_at,
        last_message_sender_id = NEW.sender_id
    WHERE id = NEW.conversation_id
      AND (conversations.updated_at IS NULL OR conversations.updated_at <= NEW.created_at);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_update_conversation_timestamp
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION update_conversation_timestamp();

-- -------------------------------------------------------------
-- 7. Trigger: Auto-manage updated_at on conversations metadata updates
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_set_updated_at
BEFORE UPDATE ON conversations
FOR EACH ROW
WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.metadata IS DISTINCT FROM NEW.metadata)
EXECUTE FUNCTION set_updated_at();
