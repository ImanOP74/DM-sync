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
  // 1. Target the text inside the chat pane header specifically
  const header = document.querySelector('div[role="main"] header') || 
                 document.querySelector('header');
  
  if (header) {
    // Look for link spans, buttons, or direct spans in the header
    const nameEl = header.querySelector('span[role="link"]') || 
                   header.querySelector('span') || 
                   header.querySelector('div[role="button"]');
    if (nameEl && nameEl.textContent.trim()) {
      const name = nameEl.textContent.trim();
      // Filter out navigation names, tabs, or system text
      if (name && name !== "Messages" && name !== "Direct" && name.length < 40) {
        return name;
      }
    }
  }

  // 2. Fallback to headings inside the main panel
  const headings = document.querySelectorAll('div[role="main"] h1, div[role="main"] h2');
  for (const h of headings) {
    const text = h.textContent.trim();
    if (text && text !== "Messages" && text !== "Direct" && text.length < 40) {
      return text;
    }
  }

  // 3. Fallback to page title if clean
  if (document.title && document.title !== "Instagram" && !document.title.includes("Messages")) {
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
 * Walks up the DOM starting from a message bubble to find the nearest preceding timestamp header.
 */
function getNearestTimestampHeader(bubble) {
  let current = bubble;
  while (current && current !== document.body) {
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (isTimestampHeader(sibling)) {
        return sibling.textContent.trim();
      }
      // Check if the sibling contains a child representing timestamp text (e.g. <time>)
      const innerTime = sibling.querySelector('time') || sibling.querySelector('[class*="timestamp"]');
      if (innerTime && innerTime.textContent.trim()) {
        return innerTime.textContent.trim();
      }
      sibling = sibling.previousElementSibling;
    }
    current = current.parentElement;
  }
  return "date_unknown";
}

/**
 * Scans the visible chat log, extracts messages, and fires sync messages.
 */
function syncAllVisibleMessages(container) {
  if (!activeThreadId) return;

  const chatName = getChatName();
  if (chatName !== activeChatName) {
    activeChatName = chatName;
    console.log(`[Instagram DM Sync] Active chat display name: "${activeChatName}"`);
  }

  // 1. Locate all text message bubbles inside the chat box
  // Exclude inputs, forms, and editable text boxes (like search inputs or draft boxes)
  const bubbles = Array.from(container.querySelectorAll('div[dir="auto"], span[dir="auto"]')).filter(el => {
    return !el.closest('[contenteditable="true"]') && 
           !el.closest('form') && 
           !el.closest('[role="textbox"]');
  });

  if (bubbles.length === 0) return;

  const newMessages = [];
  
  // Local in-memory counter to track duplicate consecutive messages under the same time block
  // Format: key `${text}_${senderId}_${timeHeader}` -> count index
  const textOccurrenceCount = {};

  bubbles.forEach((bubble) => {
    const text = bubble.textContent.trim();
    if (!text || text.length === 0) return;

    const outgoing = isOutgoingMessage(bubble);
    
    // Core Stable Identifiers: 'me' vs 'other'
    const senderId = outgoing ? 'me' : 'other';
    const senderUsername = outgoing ? 'me' : activeChatName;
    const timeHeader = getNearestTimestampHeader(bubble);

    // Calculate stable occurrence index for duplicate text sent consecutively
    const countKey = `${text}_${senderId}_${timeHeader}`;
    const occurrenceIndex = textOccurrenceCount[countKey] || 0;
    textOccurrenceCount[countKey] = occurrenceIndex + 1;

    // Generate unique ID based on in-memory order of elements
    const rawId = `${activeThreadId}_${senderId}_${text}_${timeHeader}_${occurrenceIndex}`;
    const instagramMessageId = btoa(unescape(encodeURIComponent(rawId)))
      .replace(/=/g, "")
      .substring(0, 80);

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
        // Rollback local caches for retry on next observer mutation
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
