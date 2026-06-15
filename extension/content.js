/**
 * Instagram DM Sync - Optimized Content Script
 * 
 * Key Enhancements:
 * 1. Debounced Scraper: Wraps DOM queries to run at most once every 300ms.
 * 2. Strict ID Stability: Senders are mapped strictly to 'me' or 'other'.
 *    Prevents duplicate uploads when usernames resolve dynamically.
 * 3. Selector fallbacks for header parsing and flex-layout checking.
 */

console.log("[Instagram DM Sync] Real-time content observer script active.");

// Core State
let activeThreadId = null;
let activeChatName = null;
let chatObserver = null;
let navigationTimer = null;
let containerPollingTimer = null;

// local cache of synced message hashes in the current session
const syncedMessageIds = new Set();

// Start checking URL for transitions
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
 * Cleans up observers and states.
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
 * Utility debounce function to control execution rate during layout storms.
 */
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

/**
 * Selects the scrollable messages pane in the DOM.
 */
function findChatContainer() {
  // 1. Try to find the container relative to active message rows
  const row = document.querySelector('div[role="row"]');
  if (row && row.parentElement) {
    return row.parentElement;
  }

  // 2. Look for semantic ARIA role containers
  const semanticContainer = document.querySelector('div[role="log"]') || 
                            document.querySelector('div[role="main"] div[role="presentation"]') ||
                            document.querySelector('div[role="main"]');
  if (semanticContainer) return semanticContainer;

  // 3. Fallback: Search for any scrollable content div matching typical height constraints
  try {
    const scrollableDivs = Array.from(document.querySelectorAll('div')).filter(el => {
      const style = window.getComputedStyle(el);
      return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.clientHeight > 300;
    });
    if (scrollableDivs.length > 0) {
      return scrollableDivs[0];
    }
  } catch (e) {
    console.error("[Instagram DM Sync] Error searching scrollable containers:", e);
  }

  // 4. Ultimate Fallback: Observes the whole page body if no specific log layout is loaded
  return document.body;
}

/**
 * Sets up the syncing listeners for the loaded thread ID.
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
      
      console.log("[Instagram DM Sync] Found chat container. Initializing real-time sync...");
      
      // Perform initial check
      syncAllVisibleMessages(container);

      // Setup debounced sync to handle multiple rapid DOM mutations
      const debouncedSync = debounce((targetContainer) => {
        syncAllVisibleMessages(targetContainer);
      }, 300);

      // Attach MutationObserver
      chatObserver = new MutationObserver(() => {
        debouncedSync(container);
      });

      chatObserver.observe(container, {
        childList: true,
        subtree: true
      });
      console.log("[Instagram DM Sync] Real-time MutationObserver attached successfully.");
    } else if (pollCount > 20) {
      clearInterval(containerPollingTimer);
      containerPollingTimer = null;
      console.warn("[Instagram DM Sync] Chat container not resolved within 10s.");
    }
  }, 500);
}

/**
 * Extracts conversation display title.
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
 * Checks if a message element is outgoing or incoming.
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
 * Checks if a node represents a timestamp divider row.
 */
function isTimestampHeader(element) {
  if (!element) return false;
  
  const text = element.textContent.trim();
  if (text.length === 0) return false;

  const isRow = element.getAttribute('role') === 'row' || element.querySelector('[role="row"]');
  if (isRow) return false;

  return text.includes(':') || 
         text.includes('AM') || 
         text.includes('PM') || 
         text.match(/(Today|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i) ||
         text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
}

/**
 * Walks up the DOM to find the nearest preceding timestamp header.
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
 * Extract raw text from the row.
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
 * Format: threadId + senderId + text + timeHeader + occurrenceIndex
 */
function generateStableMessageId(threadId, senderId, text, row, timeHeader) {
  let occurrenceIndex = 0;
  let current = row.previousElementSibling;

  while (current) {
    if (isTimestampHeader(current)) {
      break;
    }

    const rowDetails = getRowTextContent(current);
    if (rowDetails) {
      const currentText = rowDetails.text;
      const outgoing = isOutgoingMessage(rowDetails.element);
      const currentSender = outgoing ? 'me' : 'other'; // strictly stable 'me' or 'other'

      if (currentText === text && currentSender === senderId) {
        occurrenceIndex++;
      }
    }
    current = current.previousElementSibling;
  }

  const rawId = `${threadId}_${senderId}_${text}_${timeHeader}_${occurrenceIndex}`;
  return btoa(unescape(encodeURIComponent(rawId)))
    .replace(/=/g, "")
    .substring(0, 80);
}

/**
 * Scans the visible chat, extracts messages, and fires sync messages.
 */
function syncAllVisibleMessages(container) {
  if (!activeThreadId) return;

  const chatName = getChatName();
  if (chatName !== activeChatName) {
    activeChatName = chatName;
    console.log(`[Instagram DM Sync] Active chat display name: "${activeChatName}"`);
  }

  const rows = container.querySelectorAll('div[role="row"]');
  if (rows.length === 0) return;

  const newMessages = [];

  rows.forEach((row) => {
    const textDetails = getRowTextContent(row);
    if (!textDetails) return;

    const { text, element } = textDetails;
    const outgoing = isOutgoingMessage(element);
    
    // Core Stable Identifiers: 'me' vs 'other'
    const senderId = outgoing ? 'me' : 'other';
    const senderUsername = outgoing ? 'me' : activeChatName;

    const timeHeader = getNearestTimestampHeader(row);
    const instagramMessageId = generateStableMessageId(activeThreadId, senderId, text, row, timeHeader);

    if (syncedMessageIds.has(instagramMessageId)) {
      return;
    }

    newMessages.push({
      instagram_message_id: instagramMessageId,
      sender_id: senderId,
      sender_username: senderUsername,
      text: text,
      created_at: new Date().toISOString(),
      metadata: {
        time_header: timeHeader,
        sync_timestamp: new Date().toISOString()
      }
    });

    syncedMessageIds.add(instagramMessageId);
  });

  if (newMessages.length > 0) {
    console.log(`[Instagram DM Sync] Scraped ${newMessages.length} unsynced message(s). Syncing...`);

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
        console.error("[Instagram DM Sync] Sync call failed:", chrome.runtime.lastError.message);
        // Rollback local caches for retry next trigger
        newMessages.forEach(msg => syncedMessageIds.delete(msg.instagram_message_id));
        return;
      }

      if (response && response.success) {
        console.log(`[Instagram DM Sync] Synced successfully. Messages: ${newMessages.length}`);
      } else {
        console.error("[Instagram DM Sync] Background sync failed:", response ? response.error : 'Unknown response');
        newMessages.forEach(msg => syncedMessageIds.delete(msg.instagram_message_id));
      }
    });
  }
}
