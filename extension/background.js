import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

console.log("[Instagram DM Sync] Background service worker initialized.");

// Listen for messages from the content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'sync_thread') {
    handleSyncThread(request.payload)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => {
        console.error("[Instagram DM Sync] Background sync error:", error);
        sendResponse({ success: false, error: error.message });
      });
    
    // Return true to indicate we will send response asynchronously
    return true;
  }
});

/**
 * Handles the multi-step upsert process:
 * 1. Upserts the conversation to get the internal UUID (via return=representation).
 * 2. Appends the retrieved UUID to all message objects.
 * 3. Upserts all messages using the Supabase PostgREST API with conflict resolution.
 */
async function handleSyncThread({ conversation, messages }) {
  if (!SUPABASE_URL || SUPABASE_URL.includes("your-supabase-project-id")) {
    throw new Error("Supabase credentials not configured. Please edit config.js.");
  }

  console.log(`[Instagram DM Sync] Synchronizing thread: ${conversation.instagram_thread_id} ("${conversation.name}")`);

  // --- Step 1: Upsert Conversation & Get UUID ---
  const conversationResponse = await fetch(`${SUPABASE_URL}/rest/v1/conversations`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      // Prefer header instructions:
      // 'resolution=merge-duplicates' triggers PostgreSQL's ON CONFLICT DO UPDATE
      // 'return=representation' tells PostgREST to return the inserted/updated row data
      'Prefer': 'resolution=merge-duplicates, return=representation'
    },
    body: JSON.stringify([conversation])
  });

  if (!conversationResponse.ok) {
    const errorText = await conversationResponse.text();
    throw new Error(`Failed to sync conversation: ${conversationResponse.status} ${errorText}`);
  }

  const conversationsData = await conversationResponse.json();
  if (!conversationsData || conversationsData.length === 0) {
    throw new Error("No conversation data returned from Supabase.");
  }

  const dbConversationId = conversationsData[0].id;
  console.log(`[Instagram DM Sync] Conversation registered in DB with UUID: ${dbConversationId}`);

  if (messages.length === 0) {
    return { dbConversationId, syncedMessagesCount: 0 };
  }

  // --- Step 2: Map Messages with conversation_id UUID ---
  const mappedMessages = messages.map(msg => ({
    ...msg,
    conversation_id: dbConversationId
  }));

  // --- Step 3: Upsert Messages ---
  console.log(`[Instagram DM Sync] Upserting ${mappedMessages.length} messages to database...`);
  const messagesResponse = await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      // Use resolution=merge-duplicates and specify on-conflict target
      'Prefer': 'resolution=merge-duplicates, on-conflict=instagram_message_id'
    },
    body: JSON.stringify(mappedMessages)
  });

  if (!messagesResponse.ok) {
    const errorText = await messagesResponse.text();
    throw new Error(`Failed to sync messages: ${messagesResponse.status} ${errorText}`);
  }

  console.log(`[Instagram DM Sync] Successfully synced ${messages.length} messages.`);
  return { dbConversationId, syncedMessagesCount: messages.length };
}
