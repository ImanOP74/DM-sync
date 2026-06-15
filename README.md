# Instagram DM Sync Supabase Schema

This directory contains the database schema setup for an Instagram Direct Message (DM) Synchronization application on Supabase (PostgreSQL).

## File Structure
* [`schema.sql`](file:///c:/Coding/Dm%20Sync/schema.sql): The SQL script that creates the tables, indexes, constraints, triggers, and disables Row Level Security (RLS) for development.

---

## Database Design Summary

### Tables
1. **`conversations`**: Stores active sync threads. Map one-to-one with Instagram thread IDs via `instagram_thread_id`. Contains an auto-updating `updated_at` column to order conversations by recent activity.
2. **`messages`**: Stores actual message payloads. References `conversations.id`. Uses `instagram_message_id` as a unique constraint to ensure deduplication.

### Optimizations
* **Deduplication Constraints**: Unique keys on `conversations(instagram_thread_id)` and `messages(instagram_message_id)` guarantee that duplicate ingestion calls from sync workers do not result in duplicated rows.
* **Fast List Sort**: B-Tree index on `conversations(updated_at DESC)` ensures instantaneous rendering of the conversation list ordered by latest activity.
* **Fast Thread Loading**: Composite B-Tree index on `messages(conversation_id, created_at DESC)` allows fetching the message history of a specific conversation in optimal time.
* **Fuzzy Message Search**: Trigram GIN index on `messages(text)` enables fast substring and keyword matching using `ILIKE` operators (e.g., searching for specific words).
* **Fuzzy Sender Search**: Trigram GIN index on `messages(sender_username)` allows users to search history by sender username.
* **Auto-Update Trigger**: An database trigger updates the parent conversation's `updated_at` field automatically when a new message is inserted, keeping the chat ordering up to date.

---

## Setup Instructions

Choose **one** of the two options below to apply the schema to your Supabase project.

### Option A: Supabase Dashboard SQL Editor (Recommended for Quick Setup)

1. Open the [Supabase Dashboard](https://supabase.com/dashboard) and navigate to your project.
2. Click on the **SQL Editor** tab in the left sidebar navigation.
3. Click **New Query**.
4. Copy the entire contents of [`schema.sql`](file:///c:/Coding/Dm%20Sync/schema.sql) and paste it into the editor.
5. Click **Run** (or press `Ctrl + Enter` / `Cmd + Enter`).
6. Verify that the tables (`conversations` and `messages`) are created in your Database schema.

### Option B: Supabase CLI (Recommended for Local Development & Version Control)

If you are using the Supabase CLI locally:

1. Initialize Supabase in your project root (if not already done):
   ```bash
   supabase init
   ```
2. Create a new migration file:
   ```bash
   supabase migration new instagram_dm_sync_schema
   ```
3. Copy the contents of [`schema.sql`](file:///c:/Coding/Dm%20Sync/schema.sql) into the newly created migration file located inside `supabase/migrations/<timestamp>_instagram_dm_sync_schema.sql`.
4. Apply the migration locally:
   ```bash
   supabase db reset
   ```
5. Deploy/link to your remote project and push changes:
   ```bash
   supabase db push
   ```

---

## Example Queries for App Development

### 1. Ingesting / Syncing Messages (with Deduplication)
Use `ON CONFLICT` to insert messages without worrying about duplicates.
```sql
-- Ingesting a conversation
INSERT INTO conversations (instagram_thread_id, name, is_group, metadata)
VALUES ('17841400012345678', 'Jane Doe', false, '{"avatar_url": "https://example.com/jane.jpg"}')
ON CONFLICT (instagram_thread_id) 
DO UPDATE SET 
    name = EXCLUDED.name,
    metadata = conversations.metadata || EXCLUDED.metadata;

-- Ingesting a message
INSERT INTO messages (conversation_id, instagram_message_id, sender_id, sender_username, text, media_url, media_type, created_at)
VALUES (
    'CONVERSATION_UUID_HERE', -- UUID retrieved from conversations table
    '17900012345678901', -- Instagram Message ID
    'instagram_user_98765', -- Sender ID
    'janedoe', -- Sender Username
    'Hello! Did you get the documents?', -- Text
    NULL, -- Media URL
    NULL, -- Media Type
    '2026-06-15 18:00:00+00' -- Instagram Message Timestamp
)
ON CONFLICT (instagram_message_id) 
DO NOTHING; -- Prevents duplicates. Use DO UPDATE if you want to support message updates (like edited messages).
```

### 2. Loading Conversation List (Ordered by Latest Activity)
```sql
SELECT id, instagram_thread_id, name, is_group, metadata, updated_at
FROM conversations
ORDER BY updated_at DESC
LIMIT 50;
```

### 3. Loading Chat Thread History (Paginated)
```sql
SELECT id, sender_id, sender_username, text, media_url, media_type, created_at, metadata
FROM messages
WHERE conversation_id = 'CONVERSATION_UUID_HERE'
ORDER BY created_at DESC
LIMIT 20 OFFSET 0;
```

### 4. Fuzzy Message Searching (Utilizing Trigram Index)
```sql
SELECT m.id, m.text, m.created_at, m.sender_username, c.name AS conversation_name, c.instagram_thread_id
FROM messages m
JOIN conversations c ON m.conversation_id = c.id
WHERE m.text ILIKE '%documents%'
ORDER BY m.created_at DESC;
```
*(This query will utilize the `idx_messages_text_trgm` GIN index, allowing fast results even across millions of messages).*

---

## Chrome/Brave Extension (Manifest V3)

A lightweight extension is included inside the [`extension/`](file:///c:/Coding/Dm%20Sync/extension/) directory to automatically parse and synchronize DMs to Supabase as you browse Instagram.

### Extension File Structure
```
extension/
├── manifest.json      # Extension config & permissions
├── config.js          # Supabase API credentials
├── background.js      # Service worker bypassing page CSP
└── content.js         # Scraping logic and navigation watcher
```

### How to Install and Run the Extension

1. **Configure API Credentials**:
   - Open [`extension/config.js`](file:///c:/Coding/Dm%20Sync/extension/config.js).
   - Replace `SUPABASE_URL` and `SUPABASE_ANON_KEY` with your actual Supabase project credentials.

2. **Load Extension in Browser**:
   - Open **Chrome** or **Brave** and navigate to `chrome://extensions/`.
   - Toggle **Developer mode** (top-right corner) to **ON**.
   - Click the **Load unpacked** button (top-left corner).
   - Select the [`extension/`](file:///c:/Coding/Dm%20Sync/extension/) directory.

3. **Synchronize DMs**:
   - Go to [Instagram Direct Messages](https://www.instagram.com/direct/).
   - Click on any conversation thread.
   - The extension will automatically detect the chat, scrape the text messages, and sync them to your Supabase tables in the background.

4. **Verify Activity / View Logs**:
   - **Content Script logs (scraping)**: Right-click the Instagram page, click **Inspect**, and view the **Console** tab. Look for logs prefixed with `[Instagram DM Sync]`.
   - **Background Script logs (database connection)**: On `chrome://extensions/` under the loaded Instagram DM Sync extension card, click the link next to **Inspect views: background page** or **service worker**. This opens the background service worker console.

---

## Next.js Web Dashboard

A premium, real-time message sync dashboard built with Next.js (App Router), TypeScript, and Tailwind CSS. It connects directly to your Supabase PostgreSQL instance via WebSockets to render DMs as they arrive.

### Dashboard File Structure
```
dashboard/
├── .env.local             # Supabase environment configurations
├── src/
│   ├── lib/
│   │   └── supabaseClient.ts  # Client instantiation code
│   ├── types/
│   │   └── database.ts        # TypeScript table structures
│   └── app/
│       ├── page.tsx           # Dashboard view and realtime listeners
│       ├── layout.tsx         # HTML shell & font definitions
│       └── globals.css        # CSS styles & scrollbars
```

### How to Run the Dashboard

1. **Configure Environment Variables**:
   - Open [`dashboard/.env.local`](file:///c:/Coding/Dm%20Sync/dashboard/.env.local).
   - Enter your actual Supabase credentials for `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

2. **Configure Database Realtime Replication**:
   - To receive messages instantly without refreshing the page, enable PostgreSQL replication for the `conversations` and `messages` tables:
     1. Open your [Supabase Dashboard](https://supabase.com/dashboard).
     2. Go to **Database** -> **Replication** (in the sidebar).
     3. Under `supabase_realtime` publication, click **Source** or **Tables**.
     4. Toggle replication to **ON** for both the `conversations` and `messages` tables.

3. **Launch the Development Server**:
   - Open your terminal and navigate to the `dashboard/` directory.
   - Run the following command to start the web app:
     ```bash
     npm run dev
     ```
   - Open [http://localhost:3000](http://localhost:3000) in your browser.

4. **Build for Production**:
   - To generate a optimized production bundle, compile using:
     ```bash
     npm run build
     ```


