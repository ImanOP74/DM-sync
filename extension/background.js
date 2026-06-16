import { SUPABASE_URL, SUPABASE_ANON_KEY, TARGET_THREAD_IDS } from './config.js';

console.log("[DM Mirror] Background service worker active.");

// Listener for runtime messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'get_config') {
    sendResponse({ targetThreadIds: TARGET_THREAD_IDS || [] });
    return false; // synchronous response
  }

  if (request.action === 'sync_inbox_conversations') {
    handleSyncInboxConversations(request.payload)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => {
        console.error("[DM Mirror] Background inbox sync failed:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open
  }

  if (request.action === 'sync_thread') {
    handleSyncThread(request.payload)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => {
        console.error("[DM Mirror] Background thread sync failed:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open
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

      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        const errorText = await response.text();
        throw new Error(`Client error ${response.status}: ${errorText || response.statusText}`);
      }

      if (attempt === maxRetries) {
        throw new Error(`Server returned status code: ${response.status}`);
      }
      console.warn(`[DM Mirror] Attempt ${attempt} returned status ${response.status}. Retrying in ${delay}ms...`);
    } catch (err) {
      if (attempt === maxRetries) {
        throw err;
      }
      console.warn(`[DM Mirror] Attempt ${attempt} failed with network error: ${err.message}. Retrying in ${delay}ms...`);
    }

    await new Promise(resolve => setTimeout(resolve, delay));
    delay *= 2; // Exponential backoff spacing
  }
}

/**
 * Handles the list of visible conversations discovered in the DM inbox.
 */
async function handleSyncInboxConversations({ conversations }) {
  if (!SUPABASE_URL || SUPABASE_URL.includes("your-supabase-project-id")) {
    throw new Error("Supabase credentials not configured inside extension/config.js.");
  }

  // Filter conversations against allowed TARGET_THREAD_IDS array if populated
  const filteredConversations = conversations.filter(conv => {
    if (TARGET_THREAD_IDS && TARGET_THREAD_IDS.length > 0) {
      return TARGET_THREAD_IDS.includes(conv.conversation_id);
    }
    return true;
  });

  if (filteredConversations.length === 0) {
    return { count: 0 };
  }

  const conversationUrl = `${SUPABASE_URL}/rest/v1/conversations?on_conflict=conversation_id`;
  const conversationOptions = {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates, return=representation'
    },
    body: JSON.stringify(filteredConversations)
  };

  console.log(`[DM Mirror] Syncing ${filteredConversations.length} inbox conversation details...`);
  await fetchWithRetry(conversationUrl, conversationOptions);
  return { count: filteredConversations.length };
}

/**
 * Handles the active conversation & message upsert flow.
 * Directly inserts messages using native conversation_id (TEXT).
 */
async function handleSyncThread({ conversation, messages }) {
  if (!SUPABASE_URL || SUPABASE_URL.includes("your-supabase-project-id")) {
    throw new Error("Supabase credentials not configured inside extension/config.js.");
  }

  // Filter out any non-target thread syncs if TARGET_THREAD_IDS is specified
  if (TARGET_THREAD_IDS && TARGET_THREAD_IDS.length > 0 && !TARGET_THREAD_IDS.includes(conversation.conversation_id)) {
    console.log(`[DM Mirror] Sync ignored. Thread ID ${conversation.conversation_id} does not match any TARGET_THREAD_IDS`);
    return { dbConversationId: conversation.conversation_id, syncedMessagesCount: 0, skipped: true };
  }

  // --- Step 1: Upsert Conversation ---
  const conversationUrl = `${SUPABASE_URL}/rest/v1/conversations?on_conflict=conversation_id`;
  const conversationOptions = {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify([conversation])
  };

  console.log(`[DM Mirror] Syncing active thread details: ${conversation.conversation_id}...`);
  await fetchWithRetry(conversationUrl, conversationOptions);
  
  if (messages.length === 0) {
    return { dbConversationId: conversation.conversation_id, syncedMessagesCount: 0 };
  }

  // --- Step 2: Upsert Messages (Related directly via TEXT conversation_id) ---
  const messagesUrl = `${SUPABASE_URL}/rest/v1/messages?on_conflict=message_hash`;
  const messagesOptions = {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify(messages)
  };

  console.log(`[DM Mirror] Dispatching ${messages.length} message(s) to DB...`);
  await fetchWithRetry(messagesUrl, messagesOptions);
  
  console.log(`[DM Mirror] Synchronization verified for ${messages.length} message(s).`);
  return { dbConversationId: conversation.conversation_id, syncedMessagesCount: messages.length };
}
