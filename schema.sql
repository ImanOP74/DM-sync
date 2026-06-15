-- Instagram DM Sync Supabase Database Schema
-- Optimized for deduplication, fast retrieval of conversation threads, and message search.

-- -------------------------------------------------------------
-- 1. Extensions
-- -------------------------------------------------------------
-- Enablepg_trgm for efficient fuzzy text matching and substring searches (ILIKE %query%)
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Add descriptions to the conversations table and columns
COMMENT ON TABLE conversations IS 'Stores synchronized Instagram conversation threads.';
COMMENT ON COLUMN conversations.id IS 'Internal unique UUID identifier for the conversation.';
COMMENT ON COLUMN conversations.instagram_thread_id IS 'Unique thread identifier native to Instagram. Used to prevent duplicate threads.';
COMMENT ON COLUMN conversations.name IS 'Name of the conversation (e.g. group name or participant name).';
COMMENT ON COLUMN conversations.is_group IS 'Flag indicating if the conversation is a group chat.';
COMMENT ON COLUMN conversations.metadata IS 'Dynamic jsonb field for storing participant info, avatar URLs, and other Instagram-specific attributes.';
COMMENT ON COLUMN conversations.created_at IS 'Timestamp of when the conversation was synced/created in our database.';
COMMENT ON COLUMN conversations.updated_at IS 'Timestamp of the latest activity/message in this conversation. Used for sorting the conversation list.';

-- -------------------------------------------------------------
-- 3. Messages Table
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    instagram_message_id TEXT NOT NULL UNIQUE,
    sender_id TEXT NOT NULL,
    sender_username TEXT,
    text TEXT,
    media_url TEXT,
    media_type TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL, -- Instagram message timestamp
    synced_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Add descriptions to the messages table and columns
COMMENT ON TABLE messages IS 'Stores synchronized messages belonging to conversation threads.';
COMMENT ON COLUMN messages.id IS 'Internal unique UUID identifier for the message.';
COMMENT ON COLUMN messages.conversation_id IS 'Foreign key referencing the conversations table.';
COMMENT ON COLUMN messages.instagram_message_id IS 'Unique message identifier native to Instagram. Critical for preventing duplicate message ingestion.';
COMMENT ON COLUMN messages.sender_id IS 'Instagram-native user ID of the message sender.';
COMMENT ON COLUMN messages.sender_username IS 'Instagram username of the sender at the time of sync.';
COMMENT ON COLUMN messages.text IS 'Text content of the message. Nullable if the message contains only media.';
COMMENT ON COLUMN messages.media_url IS 'URL to the message attachment/media (image, video, voice memo) if applicable.';
COMMENT ON COLUMN messages.media_type IS 'Type of the media attachment (e.g. ''image'', ''video'', ''audio'', ''voice_media'').';
COMMENT ON COLUMN messages.metadata IS 'Dynamic jsonb field for message reactions, replies, links, and other raw payload details.';
COMMENT ON COLUMN messages.created_at IS 'The native Instagram creation timestamp of the message.';
COMMENT ON COLUMN messages.synced_at IS 'Timestamp when the message was synchronized into our database.';

-- -------------------------------------------------------------
-- 4. Optimizations: Indexes for Fast Lookups and Search
-- -------------------------------------------------------------

-- Index for ordering conversations by last activity (useful for the chat list sidebar)
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at 
ON conversations (updated_at DESC);

-- Composite index for fast thread history loading (fetching last N messages of a conversation)
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at 
ON messages (conversation_id, created_at DESC);

-- Trigram GIN index for fast full-text substring and fuzzy search in message text
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
-- 6. Trigger to automatically update conversations.updated_at
-- -------------------------------------------------------------
-- This trigger automatically updates the updated_at timestamp of a conversation
-- whenever a new message is inserted into it.
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE conversations
    SET updated_at = NEW.created_at
    WHERE id = NEW.conversation_id
      AND conversations.updated_at < NEW.created_at;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_update_conversation_timestamp
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION update_conversation_timestamp();
