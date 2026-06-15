import { SUPABASE_URL, SUPABASE_ANON_KEY, TARGET_THREAD_ID } from './config.js';

console.log("[Instagram DM Sync] Background service worker active.");

// Listener for runtime sync dispatches
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'get_config') {
    sendResponse({ targetThreadId: TARGET_THREAD_ID || null });
    return false; // synchronous response
  }

  if (request.action === 'sync_thread') {
    handleSyncThread(request.payload)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => {
        console.error("[Instagram DM Sync] Background execution failed after retries:", error);
        sendResponse({ success: false, error: error.message });
      });
    
    return true; // Keep message channel open for async execution
  }
});

/**
 * Enhanced fetch engine equipped with exponential backoff retry logic.
 */
async function fetchWithRetry(url, options, maxRetries = 3, initialDelay = 1000) {
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      if (response.ok) {
        return response;
      }

      // If it's a standard client error (excluding rate limits 429), don't bother retrying
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        const errorText = await response.text();
        throw new Error(`Client error ${response.status}: ${errorText || response.statusText}`);
      }

      // Server error or rate limit, trigger retry delay
      if (attempt === maxRetries) {
        throw new Error(`Server returned status code: ${response.status}`);
      }
      console.warn(`[Instagram DM Sync] Attempt ${attempt} returned status ${response.status}. Retrying in ${delay}ms...`);
    } catch (err) {
      if (attempt === maxRetries) {
        throw err;
      }
      console.warn(`[Instagram DM Sync] Attempt ${attempt} failed with network error: ${err.message}. Retrying in ${delay}ms...`);
    }

    await new Promise(resolve => setTimeout(resolve, delay));
    delay *= 2; // Exponential spacing
  }
}

/**
 * Handles the conversation & message upsert flow with retry capability.
 */
async function handleSyncThread({ conversation, messages }) {
  if (!SUPABASE_URL || SUPABASE_URL.includes("your-supabase-project-id")) {
    throw new Error("Supabase credentials not configured inside extension/config.js.");
  }

  // Filter out any non-target thread syncs if TARGET_THREAD_ID is specified
  if (TARGET_THREAD_ID && conversation.instagram_thread_id !== TARGET_THREAD_ID) {
    console.log(`[Instagram DM Sync] Sync ignored. Thread ID ${conversation.instagram_thread_id} does not match TARGET_THREAD_ID ${TARGET_THREAD_ID}`);
    return { dbConversationId: null, syncedMessagesCount: 0, skipped: true };
  }

  // --- Step 1: Upsert Conversation with Retry ---
  const conversationUrl = `${SUPABASE_URL}/rest/v1/conversations`;
  const conversationOptions = {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates, return=representation'
    },
    body: JSON.stringify([conversation])
  };

  console.log(`[Instagram DM Sync] Syncing thread details: ${conversation.instagram_thread_id}...`);
  const conversationResponse = await fetchWithRetry(conversationUrl, conversationOptions);
  
  const conversationsData = await conversationResponse.json();
  if (!conversationsData || conversationsData.length === 0) {
    throw new Error("Empty conversation representation returned from database.");
  }

  const dbConversationId = conversationsData[0].id;
  console.log(`[Instagram DM Sync] Chat mapped to DB UUID: ${dbConversationId}`);

  if (messages.length === 0) {
    return { dbConversationId, syncedMessagesCount: 0 };
  }

  // --- Step 2: Bind internal UUID to messages ---
  const mappedMessages = messages.map(msg => ({
    ...msg,
    conversation_id: dbConversationId
  }));

  // --- Step 3: Upsert Messages with Retry ---
  const messagesUrl = `${SUPABASE_URL}/rest/v1/messages`;
  const messagesOptions = {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates, on-conflict=instagram_message_id'
    },
    body: JSON.stringify(mappedMessages)
  };

  console.log(`[Instagram DM Sync] Dispatching ${mappedMessages.length} message(s) to DB...`);
  await fetchWithRetry(messagesUrl, messagesOptions);
  
  console.log(`[Instagram DM Sync] Synchronization verified for ${messages.length} message(s).`);
  return { dbConversationId, syncedMessagesCount: messages.length };
}
