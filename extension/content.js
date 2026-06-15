/**
 * Instagram DM Sync - Upgraded Content Script
 * 
 * Key Features:
 * 1. MutationObserver: Monitors the chat container for real-time DOM changes.
 * 2. Stable Deduplication: Uses block-relative occurrence offsets & timestamp dividers
 *    to generate hashes that are stable across page reloads and scroll-ups.
 * 3. Navigation Hooks: Gracefully manages thread changes in Instagram's Single Page App.
 */

console.log("[Instagram DM Sync] Real-time content observer script active.");

// Core State
let activeThreadId = null;
let activeChatName = null;
let chatObserver = null;
let navigationTimer = null;
let containerPollingTimer = null;

// local in-memory set to prevent double uploads within the same execution session
const syncedMessageIds = new Set();

// Start watching the URL for conversation changes
navigationTimer = setInterval(checkNavigation, 1000);

/**
 * Periodically verifies if the user has navigated to another chat.
 */
function checkNavigation() {
  const url = window.location.href;
  const threadMatch = url.match(/\/direct\/t\/([a-zA-Z0-9_-]+)/);
  const currentThreadId = threadMatch ? threadMatch[1] : null;

  if (currentThreadId !== activeThreadId) {
    if (currentThreadId) {
      console.log(`[Instagram DM Sync] Navigated to thread: ${currentThreadId}. Connecting observer...`);
      initializeThreadSync(currentThreadId);
    } else {
      console.log("[Instagram DM Sync] Navigated away from chat. Disconnecting observer.");
      cleanupThreadSync();
    }
  }
}

/**
 * Cleans up existing observers and intervals to prevent leaks.
 */
function cleanupThreadSync() {
  if (chatObserver) {
    chatObserver.disconnect();
    chatObserver = null;
  }
  if (containerPollingTimer) {
    clearInterval(containerPollingTimer);
    containerPollingTimer = null;
  }
  activeThreadId = null;
  activeChatName = null;
  syncedMessageIds.clear();
}

/**
 * Finds the appropriate message list scroll container in the DOM.
 */
function findChatContainer() {
  // Try role="log" (standard scroll container), presentation wrapper, or the main content pane
  return document.querySelector('div[role="main"] div[role="log"]') || 
         document.querySelector('div[role="log"]') ||
         document.querySelector('div[role="main"] div[role="presentation"]') ||
         document.querySelector('div[role="main"]');
}

/**
 * Initializes the sync process for a new thread by polling for the container,
 * doing an initial parse, and attaching the MutationObserver.
 */
function initializeThreadSync(threadId) {
  cleanupThreadSync();
  activeThreadId = threadId;

  let pollCount = 0;
  containerPollingTimer = setInterval(() => {
    const container = findChatContainer();
    pollCount++;

    if (container) {
      clearInterval(containerPollingTimer);
      containerPollingTimer = null;
      
      console.log("[Instagram DM Sync] Found chat container. Running initial scrape...");
      // Perform immediate initial sync
      syncAllVisibleMessages(container);

      // Attach MutationObserver for real-time tracking
      chatObserver = new MutationObserver((mutations) => {
        // Debounce slightly or run immediately since local filtering is highly efficient
        syncAllVisibleMessages(container);
      });

      chatObserver.observe(container, {
        childList: true,
        subtree: true
      });
      console.log("[Instagram DM Sync] MutationObserver attached to chat container successfully.");
    } else if (pollCount > 20) {
      // Stop polling after 10 seconds to avoid infinite resource consumption
      clearInterval(containerPollingTimer);
      containerPollingTimer = null;
      console.warn("[Instagram DM Sync] Chat container not found after 10s. Retrying on next navigation.");
    }
  }, 500);
}

/**
 * Extracts conversation title name.
 */
function getChatName() {
  const selectors = [
    'div[role="main"] header span[role="link"]',
    'div[role="main"] header span',
    'div[role="main"] h1',
    'span[role="link"]'
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent.trim()) {
      return el.textContent.trim();
    }
  }

  if (document.title && document.title !== "Instagram") {
    return document.title.replace(" • Instagram", "").replace("Chat", "").trim();
  }
  return `Instagram Chat ${activeThreadId}`;
}

/**
 * Identifies if a row is a date/time header separating messages.
 */
function isTimestampHeader(element) {
  if (!element) return false;
  
  const text = element.textContent.trim();
  if (text.length === 0) return false;

  // Timestamps usually do not match message structures (don't have role="row" and are center-aligned)
  const isRow = element.getAttribute('role') === 'row' || element.querySelector('[role="row"]');
  if (isRow) return false;

  // Matches basic time/date text indicators
  const hasTimeIndicator = text.includes(':') || 
                           text.includes('AM') || 
                           text.includes('PM') || 
                           text.match(/(Today|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i) ||
                           text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);

  return hasTimeIndicator;
}

/**
 * Walks up the DOM starting from a message row to find the nearest preceding timestamp header.
 */
function getNearestTimestampHeader(row) {
  let current = row.previousElementSibling;
  while (current) {
    if (isTimestampHeader(current)) {
      return current.textContent.trim();
    }
    current = current.previousElementSibling;
  }
  return "date_unknown";
}

/**
 * Inspects styles and positions to check if the message was sent by the active user.
 */
function isOutgoingMessage(element) {
  let parent = element.parentElement;
  while (parent && parent !== document.body && parent.tagName !== 'DIV') {
    parent = parent.parentElement;
  }
  
  if (parent) {
    const styleAttr = parent.getAttribute('style') || '';
    const classAttr = parent.className || '';
    if (
      styleAttr.includes('justify-content: flex-end') ||
      styleAttr.includes('align-items: flex-end') ||
      classAttr.includes('x1qjc9v5')
    ) {
      return true;
    }
  }

  const chatLog = element.closest('div[role="main"]') || document.querySelector('div[role="log"]');
  if (chatLog) {
    const chatRect = chatLog.getBoundingClientRect();
    const elRect = element.getBoundingClientRect();
    const chatCenter = chatRect.left + (chatRect.width / 2);
    return (elRect.left + elRect.width / 2) > chatCenter;
  }

  return false;
}

/**
 * Extracts raw text from a message row element.
 */
function getRowTextContent(row) {
  const textElements = row.querySelectorAll('div[dir="auto"], span');
  for (const el of textElements) {
    const text = el.textContent.trim();
    if (text && text.length > 0 && !el.querySelector('svg')) {
      return { text, element: el };
    }
  }
  return null;
}

/**
 * Generates a stable unique ID for a message that is independent of pagination or scroll-up indices.
 * Relies on: threadId + sender + messageText + timeHeader + consecutiveOccurrenceIndex
 */
function generateStableMessageId(threadId, senderId, text, row, timeHeader) {
  let occurrenceIndex = 0;
  let current = row.previousElementSibling;

  // Walk backwards to find how many identical messages by the same sender appear under the same time block
  while (current) {
    if (isTimestampHeader(current)) {
      break; // Hit boundary of the timestamp block
    }

    const rowDetails = getRowTextContent(current);
    if (rowDetails) {
      const currentText = rowDetails.text;
      const outgoing = isOutgoingMessage(rowDetails.element);
      const currentSender = outgoing ? 'me' : `instagram_${activeChatName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

      if (currentText === text && currentSender === senderId) {
        occurrenceIndex++;
      }
    }
    current = current.previousElementSibling;
  }

  const rawId = `${threadId}_${senderId}_${text}_${timeHeader}_${occurrenceIndex}`;
  
  // Safe base64 string signature, trimmed to 80 chars max
  return btoa(unescape(encodeURIComponent(rawId)))
    .replace(/=/g, "")
    .substring(0, 80);
}

/**
 * Scans the visible container, parses rows, determines uniqueness, and triggers sync payloads.
 */
function syncAllVisibleMessages(container) {
  if (!activeThreadId) return;

  const chatName = getChatName();
  if (chatName !== activeChatName) {
    activeChatName = chatName;
    console.log(`[Instagram DM Sync] Set active thread chat name: "${activeChatName}"`);
  }

  // Find all message rows
  const rows = container.querySelectorAll('div[role="row"]');
  if (rows.length === 0) return;

  const newMessages = [];

  rows.forEach((row) => {
    const textDetails = getRowTextContent(row);
    if (!textDetails) return;

    const { text, element } = textDetails;
    const outgoing = isOutgoingMessage(element);
    const senderUsername = outgoing ? 'me' : activeChatName;
    const senderId = outgoing ? 'me' : `instagram_${activeChatName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

    // Extract the nearest preceding timestamp separator
    const timeHeader = getNearestTimestampHeader(row);

    // Generate a unique, stable message identifier
    const instagramMessageId = generateStableMessageId(activeThreadId, senderId, text, row, timeHeader);

    // Skip if it was already processed in the current session
    if (syncedMessageIds.has(instagramMessageId)) {
      return;
    }

    // Prepare message payload
    newMessages.push({
      instagram_message_id: instagramMessageId,
      sender_id: senderId,
      sender_username: senderUsername,
      text: text,
      created_at: new Date().toISOString(), // Standard timestamp
      metadata: {
        time_header: timeHeader,
        sync_timestamp: new Date().toISOString()
      }
    });

    syncedMessageIds.add(instagramMessageId);
  });

  // Sync new messages
  if (newMessages.length > 0) {
    console.log(`[Instagram DM Sync] [Real Time] Detected ${newMessages.length} new message(s). Syncing...`);

    chrome.runtime.sendMessage({
      action: 'sync_thread',
      payload: {
        conversation: {
          instagram_thread_id: activeThreadId,
          name: activeChatName,
          is_group: false
        },
        messages: newMessages
      }
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("[Instagram DM Sync] Sync dispatch communication failed:", chrome.runtime.lastError.message);
        // Rollback local sets so it can try again
        newMessages.forEach(msg => syncedMessageIds.delete(msg.instagram_message_id));
        return;
      }

      if (response && response.success) {
        console.log(`[Instagram DM Sync] Real-time sync complete for ${newMessages.length} message(s).`);
      } else {
        console.error("[Instagram DM Sync] Sync execution failed:", response ? response.error : 'Unknown response');
        newMessages.forEach(msg => syncedMessageIds.delete(msg.instagram_message_id));
      }
    });
  }
}
