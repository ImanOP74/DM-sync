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
      // Retrieve TARGET_THREAD_IDS configuration dynamically from background worker
      chrome.runtime.sendMessage({ action: 'get_config' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("[Instagram DM Sync] Failed to retrieve configuration from background worker:", chrome.runtime.lastError.message);
          // Fallback: continue initialization
          initializeThreadSync(currentThreadId);
          return;
        }

        const targetThreadIds = response?.targetThreadIds || [];
        if (targetThreadIds.length > 0 && !targetThreadIds.includes(currentThreadId)) {
          console.log(`[Instagram DM Sync] Current thread (${currentThreadId}) is NOT in the target thread list (${targetThreadIds.join(', ')}). Real-time sync disabled.`);
          cleanupThreadSync();
          // Cache the current thread ID to avoid repeating logs on every navigation check interval
          activeThreadId = currentThreadId;
          return;
        }

        console.log(`[Instagram DM Sync] Navigated to target thread: ${currentThreadId}. Connecting observer...`);
        initializeThreadSync(currentThreadId);
      });
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
  removeSyncButton();
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
      
      // Render the floating Sync History button for target threads
      renderSyncButton();
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
  // Helper to extract text content without inner SVGs, images or icon indicators
  const cleanElementText = (el) => {
    if (!el) return "";
    const clone = el.cloneNode(true);
    // Remove all SVGs, images, and elements with icon/chevron class patterns
    clone.querySelectorAll('svg, img, [role="img"], [class*="icon"], [class*="Chevron"], [class*="chevron"]').forEach(node => node.remove());
    // Strip trailing chevron text fallbacks
    return clone.textContent.replace(/Down chevron icon/gi, '').replace(/chevron/gi, '').trim();
  };

  // Helper to rank names (prefer spaces, camelcase/uppercase, penalize underscores/dots)
  const rankCandidates = (candidates) => {
    if (candidates.length === 0) return null;
    const scored = candidates.map(name => {
      let score = 0;
      if (name.includes(' ')) score += 10;
      if (/[A-Z]/.test(name)) score += 5;
      if (name.includes('_') || name.includes('.')) score -= 3;
      if (name.length >= 3 && name.length <= 25) score += 2;
      return { name, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0].name;
  };

  // 1. Try to get candidates from the sidebar list link matching our activeThreadId first.
  // The sidebar item is highly reliable because it shows the display name (e.g. "My Boy") as shown in the chat list.
  const sidebarCandidates = [];
  const sidebarLinks = Array.from(document.querySelectorAll('a[href*="/direct/t/"]'));
  for (const link of sidebarLinks) {
    if (link.href.includes(activeThreadId)) {
      const spans = Array.from(link.querySelectorAll('span, div'));
      for (const span of spans) {
        if (span.children.length === 0) {
          const text = cleanElementText(span);
          if (isValidChatName(text)) {
            sidebarCandidates.push(text);
          }
        }
      }
    }
  }

  const bestSidebarName = rankCandidates(sidebarCandidates);
  if (bestSidebarName) {
    return bestSidebarName;
  }

  // 2. Try to find the header container inside the main chat layout
  const chatPane = document.querySelector('div[role="main"]') || 
                   document.querySelector('section');
  if (chatPane) {
    // Search for <header> element specifically within the chatPane (avoiding global headers)
    const header = chatPane.querySelector('header');
    if (header) {
      const headerCandidates = [];
      const candidateElements = Array.from(header.querySelectorAll('span[role="link"], a, span, div[role="button"]'));
      for (const el of candidateElements) {
        const text = cleanElementText(el);
        if (isValidChatName(text)) {
          headerCandidates.push(text);
        }
      }
      const bestHeaderName = rankCandidates(headerCandidates);
      if (bestHeaderName) {
        return bestHeaderName;
      }
    }

    // 3. Fallback: Search the top region of the chat pane for links/buttons with text
    // The header is always at the top of the chat area; we check elements within the top 120px
    const chatPaneRect = chatPane.getBoundingClientRect();
    const elements = Array.from(chatPane.querySelectorAll('span, a, div[role="button"], h1, h2, h3'));
    const topCandidates = [];
    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      if (rect.top >= chatPaneRect.top && rect.top <= chatPaneRect.top + 120 && rect.height > 0) {
        const text = cleanElementText(el);
        if (isValidChatName(text)) {
          topCandidates.push(text);
        }
      }
    }
    const bestTopName = rankCandidates(topCandidates);
    if (bestTopName) {
      return bestTopName;
    }
  }

  // 4. Fallback: Look at the page title if it is clean
  if (document.title && !document.title.includes("Instagram") && !document.title.includes("Messages") && !document.title.includes("Direct")) {
    const cleanTitle = document.title.replace(" • Instagram", "").replace("Chat", "").trim();
    if (cleanTitle && cleanTitle.length < 40) {
      return cleanTitle;
    }
  }

  return `Instagram Chat ${activeThreadId}`;
}

/**
 * Validates whether a text string is likely the actual display name of a chat participant.
 */
function isValidChatName(text) {
  if (!text) return false;
  if (text.length > 40) return false;

  const lowerText = text.toLowerCase();
  const exclusions = [
    "messages", "direct", "active", "online", "ago", "audio", "video", 
    "call", "chat", "info", "details", "group", "instagram", "search", 
    "cancel", "done", "next", "loading", "profile", "view profile", 
    "active now", "active today", "active yesterday", "active 1h ago",
    "active 2h ago", "active 3h ago", "active 4h ago", "active 5h ago"
  ];

  if (exclusions.includes(lowerText)) return false;
  if (exclusions.some(exc => lowerText.startsWith(exc) || lowerText.endsWith(exc))) return false;

  // Exclude purely numeric strings
  if (/^\d+$/.test(text)) return false;
  // Exclude strings containing time dividers or path components
  if (text.includes(":") || text.includes("/") || text.includes("\\")) return false;

  return true;
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

// ==========================================
// Historical Messages Sync UI & Engine
// ==========================================
let syncButton = null;
let isSyncingHistory = false;
let autoScrollInterval = null;

function renderSyncButton() {
  removeSyncButton();

  if (!activeThreadId) return;

  syncButton = document.createElement('button');
  syncButton.id = 'insta-dm-sync-history-btn';
  syncButton.innerText = 'Sync History';
  
  // Premium glassmorphic Instagram UI styling
  syncButton.style.position = 'fixed';
  syncButton.style.top = '72px';
  syncButton.style.left = '60%';
  syncButton.style.transform = 'translateX(-50%)';
  syncButton.style.zIndex = '99999';
  syncButton.style.backgroundColor = '#0095f6'; // Instagram Brand Blue
  syncButton.style.color = '#ffffff';
  syncButton.style.border = 'none';
  syncButton.style.borderRadius = '20px';
  syncButton.style.padding = '8px 16px';
  syncButton.style.fontSize = '12px';
  syncButton.style.fontWeight = '600';
  syncButton.style.cursor = 'pointer';
  syncButton.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.4)';
  syncButton.style.transition = 'all 0.2s ease-in-out';
  
  syncButton.addEventListener('mouseenter', () => {
    if (!isSyncingHistory) {
      syncButton.style.backgroundColor = '#1877f2';
      syncButton.style.transform = 'translateX(-50%) scale(1.05)';
    }
  });
  
  syncButton.addEventListener('mouseleave', () => {
    if (!isSyncingHistory) {
      syncButton.style.backgroundColor = '#0095f6';
      syncButton.style.transform = 'translateX(-50%) scale(1)';
    }
  });

  syncButton.addEventListener('click', toggleHistorySync);

  document.body.appendChild(syncButton);
  console.log("[Instagram DM Sync] Rendered history sync controls.");
}

function removeSyncButton() {
  stopHistorySync();
  if (syncButton) {
    syncButton.remove();
    syncButton = null;
  }
}

function toggleHistorySync() {
  if (isSyncingHistory) {
    stopHistorySync();
  } else {
    startHistorySync();
  }
}

function startHistorySync() {
  const container = findChatContainer();
  if (!container) {
    alert("Chat container not ready. Please try again in a moment.");
    return;
  }

  isSyncingHistory = true;
  syncButton.innerText = 'Syncing History... (Click to Stop)';
  syncButton.style.backgroundColor = '#fa3e3e'; // Alert red to show it is scrolling
  
  console.log("[Instagram DM Sync] History backlog sync started.");

  let lastScrollHeight = container.scrollHeight;
  let consecutiveSameHeightCount = 0;

  autoScrollInterval = setInterval(() => {
    const activeContainer = findChatContainer();
    if (!activeContainer) {
      stopHistorySync();
      return;
    }

    // Scroll to the very top to force loading older history
    activeContainer.scrollTop = 0;

    setTimeout(() => {
      const newScrollHeight = activeContainer.scrollHeight;

      if (newScrollHeight === lastScrollHeight) {
        consecutiveSameHeightCount++;
        // If height doesn't increase for 5 attempts, we reached the first message
        if (consecutiveSameHeightCount >= 5) {
          console.log("[Instagram DM Sync] History fully fetched.");
          if (syncButton) {
            syncButton.innerText = 'History Synced!';
            syncButton.style.backgroundColor = '#4caf50'; // Green for success
          }
          setTimeout(() => {
            if (syncButton && !isSyncingHistory) {
              syncButton.innerText = 'Sync History';
              syncButton.style.backgroundColor = '#0095f6';
            }
          }, 3000);
          stopHistorySync();
        }
      } else {
        // More history was loaded! Reset counter.
        consecutiveSameHeightCount = 0;
        lastScrollHeight = newScrollHeight;
        console.log(`[Instagram DM Sync] History expanded: ${newScrollHeight}px. Continuing scrolling...`);
      }
    }, 1200); // 1.2s DOM load delay

  }, 1800); // Check every 1.8s
}

function stopHistorySync() {
  isSyncingHistory = false;
  if (autoScrollInterval) {
    clearInterval(autoScrollInterval);
    autoScrollInterval = null;
  }
  if (syncButton) {
    syncButton.innerText = 'Sync History';
    syncButton.style.backgroundColor = '#0095f6';
  }
  console.log("[Instagram DM Sync] History backlog sync stopped.");
}
