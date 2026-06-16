/**
 * DM Mirror - Optimized Content Script
 * 
 * Key Features:
 * 1. Debounced Scraper: Wraps DOM queries to run at most once every 300ms.
 * 2. Strict ID Stability: Senders are mapped to 'me' or participant name.
 * 3. Automated Inbox Scraper: Detects and syncs visible DM conversations in the inbox view.
 * 4. React Event Dispatcher: Auto-scroller dispatches native scroll events.
 * 5. Sender Username Extraction: Scrapes sender usernames (especially in group chats) and maps columns to specification.
 */

console.log("[DM Mirror] Real-time content observer script active.");

// Core State
let activeThreadId = null;
let activeChatName = null;
let chatObserver = null;
let navigationTimer = null;
let containerPollingTimer = null;
let lastInboxScrapeTime = 0;

// Local cache of synced message hashes in the current session
const syncedMessageIds = new Set();

// Start checking URL for transitions and scanning inbox threads periodically
navigationTimer = setInterval(() => {
  checkNavigation();
  scrapeInboxConversations();
}, 1000);

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
          console.error("[DM Mirror] Failed to retrieve configuration from background worker:", chrome.runtime.lastError.message);
          initializeThreadSync(currentThreadId);
          return;
        }

        const targetThreadIds = response?.targetThreadIds || [];
        if (targetThreadIds.length > 0 && !targetThreadIds.includes(currentThreadId)) {
          console.log(`[DM Mirror] Current thread (${currentThreadId}) is NOT in the target thread list (${targetThreadIds.join(', ')}). Real-time sync disabled.`);
          cleanupThreadSync();
          activeThreadId = currentThreadId;
          return;
        }

        console.log(`[DM Mirror] Navigated to target thread: ${currentThreadId}. Connecting observer...`);
        initializeThreadSync(currentThreadId);
      });
    } else {
      console.log("[DM Mirror] Navigated away from chat. Disconnecting observer.");
      cleanupThreadSync();
    }
  }
}

/**
 * Periodically detects all conversations currently visible in the DM inbox list and syncs them.
 */
function scrapeInboxConversations() {
  const now = Date.now();
  if (now - lastInboxScrapeTime < 4000) return; // Throttle inbox scanning to once every 4 seconds
  lastInboxScrapeTime = now;

  const sidebarLinks = Array.from(document.querySelectorAll('a[href*="/direct/t/"]'));
  if (sidebarLinks.length === 0) return;

  const conversations = [];

  sidebarLinks.forEach(link => {
    const href = link.getAttribute('href') || '';
    const threadMatch = href.match(/\/direct\/t\/([a-zA-Z0-9_-]+)/);
    if (!threadMatch) return;
    const conversationId = threadMatch[1];

    // Scrape profile image URL
    const img = link.querySelector('img');
    const avatarUrl = img ? img.getAttribute('src') : null;

    // Scrape display name from leaf text elements under the link container
    const textElements = Array.from(link.querySelectorAll('span, div')).map(el => {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('svg, img, [role="img"], [class*="icon"], [class*="Chevron"], [class*="chevron"]').forEach(node => node.remove());
      return clone.textContent.replace(/Down chevron icon/gi, '').replace(/chevron/gi, '').trim();
    }).filter(t => t.length > 0);

    let username = null;
    let lastMessage = null;

    if (textElements.length > 0) {
      // Find the first valid username candidate
      for (const t of textElements) {
        if (isValidChatName(t)) {
          username = t;
          break;
        }
      }

      // The last message preview is typically the first text element that contains a separator or is adjacent to the name
      const previewEl = Array.from(link.querySelectorAll('span')).find(span => {
        const txt = span.textContent;
        return txt && (txt.includes('•') || txt.toLowerCase().includes('sent') || txt.toLowerCase().includes('active'));
      });

      if (previewEl) {
        lastMessage = previewEl.textContent.trim();
      } else {
        const index = textElements.indexOf(username);
        if (index !== -1 && textElements[index + 1]) {
          lastMessage = textElements[index + 1];
        }
      }
    }

    if (conversationId && username) {
      conversations.push({
        conversation_id: conversationId,
        conversation_name: username,
        avatar_url: avatarUrl,
        last_message: lastMessage || '',
        updated_at: new Date().toISOString()
      });
    }
  });

  if (conversations.length > 0) {
    chrome.runtime.sendMessage({
      action: 'sync_inbox_conversations',
      payload: { conversations }
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("[DM Mirror] Failed to dispatch inbox conversations sync:", chrome.runtime.lastError.message);
      }
    });
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
 * Selects the scrollable messages pane in the DOM using bubble-ancestor traversal.
 */
function findChatContainer() {
  // 1. Try to find the scrollable container relative to a message bubble (highly robust)
  const bubble = document.querySelector('div[dir="auto"]');
  if (bubble) {
    let parent = bubble.parentElement;
    while (parent && parent !== document.body) {
      const style = window.getComputedStyle(parent);
      const overflow = style.overflowY || style.overflow || '';
      if ((overflow.includes('auto') || overflow.includes('scroll')) && parent.scrollHeight > parent.clientHeight) {
        return parent;
      }
      parent = parent.parentElement;
    }
  }

  // 2. Fallback: Find the container relative to active message rows
  const row = document.querySelector('div[role="row"]');
  if (row && row.parentElement) {
    return row.parentElement;
  }

  // 3. Fallback: Look for semantic ARIA role containers
  const semanticContainer = document.querySelector('div[role="log"]') || 
                            document.querySelector('div[role="main"] div[role="presentation"]') ||
                            document.querySelector('div[role="main"]');
  if (semanticContainer) return semanticContainer;

  // 4. Fallback: Search for any scrollable content div matching typical height constraints
  try {
    const scrollableDivs = Array.from(document.querySelectorAll('div')).filter(el => {
      const style = window.getComputedStyle(el);
      const overflow = style.overflowY || style.overflow || '';
      return (overflow.includes('auto') || overflow.includes('scroll')) && el.scrollHeight > el.clientHeight && el.clientHeight > 200;
    });
    if (scrollableDivs.length > 0) {
      return scrollableDivs[0];
    }
  } catch (e) {
    console.error("[DM Mirror] Error searching scrollable containers:", e);
  }

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
      
      console.log("[DM Mirror] Found chat container. Initializing real-time sync...");
      
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
      console.log("[DM Mirror] Real-time MutationObserver attached successfully.");
      
      // Render the floating Sync History button
      renderSyncButton();
    } else if (pollCount > 20) {
      clearInterval(containerPollingTimer);
      containerPollingTimer = null;
      console.warn("[DM Mirror] Chat container not resolved within 10s.");
    }
  }, 500);
}

/**
 * Extracts conversation display title.
 */
function getChatName() {
  const cleanElementText = (el) => {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll('svg, img, [role="img"], [class*="icon"], [class*="Chevron"], [class*="chevron"]').forEach(node => node.remove());
    return clone.textContent.replace(/Down chevron icon/gi, '').replace(/chevron/gi, '').trim();
  };

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

  // 1. Try sidebar first
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

  // 2. Try chat header
  const chatPane = document.querySelector('div[role="main"]') || 
                   document.querySelector('section');
  if (chatPane) {
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

    // 3. Try top chat section
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

  // 4. Fallback page title
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

  if (/^\d+$/.test(text)) return false;
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
 * Scrapes sender's username (especially useful in group chats where name is shown above the bubble group).
 */
function findSenderUsername(bubble, container) {
  let parent = bubble.parentElement;
  while (parent && parent !== container && parent.tagName !== 'BODY') {
    // Check preceding siblings of the bubble's parent element
    let sibling = parent.previousElementSibling;
    if (sibling) {
      const text = sibling.textContent.trim();
      if (text && text.length > 0 && text.length < 30 && !isTimestampHeader(sibling) && isValidChatName(text)) {
        return text;
      }
    }
    parent = parent.parentElement;
  }
  return null;
}

/**
 * Scans the visible chat log, extracts messages, and fires sync messages.
 */
function syncAllVisibleMessages(container) {
  if (!activeThreadId) return;

  const chatName = getChatName();
  if (chatName !== activeChatName) {
    activeChatName = chatName;
    console.log(`[DM Mirror] Active chat display name: "${activeChatName}"`);
  }

  // Scrape avatar URL of the active thread participant
  let activeChatAvatarUrl = null;
  const chatPane = document.querySelector('div[role="main"]') || document.querySelector('section');
  if (chatPane) {
    const header = chatPane.querySelector('header');
    if (header) {
      const img = header.querySelector('img');
      if (img) activeChatAvatarUrl = img.getAttribute('src');
    }
  }

  const bubbles = Array.from(container.querySelectorAll('div[dir="auto"], span[dir="auto"]')).filter(el => {
    return !el.closest('[contenteditable="true"]') && 
           !el.closest('form') && 
           !el.closest('[role="textbox"]');
  });

  if (bubbles.length === 0) return;

  const newMessages = [];
  const textOccurrenceCount = {};

  bubbles.forEach((bubble) => {
    const text = bubble.textContent.trim();
    if (!text || text.length === 0) return;

    const outgoing = isOutgoingMessage(bubble);
    const senderName = outgoing ? 'me' : activeChatName;
    
    // Scrape sender username: check DOM above bubble or fall back
    const scrapedUsername = outgoing ? 'me' : findSenderUsername(bubble, container);
    const senderUsername = scrapedUsername || senderName;
    
    const timeHeader = getNearestTimestampHeader(bubble);

    // Calculate occurrence index for duplicate consecutive texts
    const countKey = `${text}_${outgoing ? 'me' : 'other'}_${timeHeader}`;
    const occurrenceIndex = textOccurrenceCount[countKey] || 0;
    textOccurrenceCount[countKey] = occurrenceIndex + 1;

    // Generate unique ID based on values to be deterministic
    const rawId = `${activeThreadId}_${outgoing ? 'me' : 'other'}_${text}_${timeHeader}_${occurrenceIndex}`;
    const messageHash = btoa(unescape(encodeURIComponent(rawId)))
      .replace(/=/g, "")
      .substring(0, 80);

    if (syncedMessageIds.has(messageHash)) {
      return;
    }

    newMessages.push({
      conversation_id: activeThreadId, // TEXT ID directly linked
      message_hash: messageHash,
      sender_name: senderName,
      sender_username: senderUsername,
      content: text,
      timestamp: new Date().toISOString(),
      sent_by_me: outgoing
    });

    syncedMessageIds.add(messageHash);
  });

  if (newMessages.length > 0) {
    console.log(`[DM Mirror] Scraped ${newMessages.length} unsynced message(s). Syncing...`);

    chrome.runtime.sendMessage({
      action: 'sync_thread',
      payload: {
        conversation: {
          conversation_id: activeThreadId,
          conversation_name: activeChatName,
          avatar_url: activeChatAvatarUrl,
          last_message: newMessages[newMessages.length - 1].content,
          updated_at: new Date().toISOString()
        },
        messages: newMessages
      }
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("[DM Mirror] Sync call failed:", chrome.runtime.lastError.message);
        newMessages.forEach(msg => syncedMessageIds.delete(msg.message_hash));
        return;
      }

      if (response && response.success) {
        console.log(`[DM Mirror] Synced successfully. Messages: ${newMessages.length}`);
      } else {
        console.error("[DM Mirror] Background sync failed:", response ? response.error : 'Unknown response');
        newMessages.forEach(msg => syncedMessageIds.delete(msg.message_hash));
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
  console.log("[DM Mirror] Rendered history sync controls.");
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
  
  console.log("[DM Mirror] History backlog sync started.");

  let lastScrollHeight = container.scrollHeight;
  let consecutiveSameHeightCount = 0;

  autoScrollInterval = setInterval(() => {
    const activeContainer = findChatContainer();
    if (!activeContainer) {
      stopHistorySync();
      return;
    }

    activeContainer.scrollTop = 0;
    activeContainer.dispatchEvent(new Event('scroll', { bubbles: true }));

    setTimeout(() => {
      const newScrollHeight = activeContainer.scrollHeight;

      if (newScrollHeight === lastScrollHeight) {
        consecutiveSameHeightCount++;
        if (consecutiveSameHeightCount >= 5) {
          console.log("[DM Mirror] History fully fetched.");
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
        consecutiveSameHeightCount = 0;
        lastScrollHeight = newScrollHeight;
        console.log(`[DM Mirror] History expanded: ${newScrollHeight}px. Continuing scrolling...`);
      }
    }, 1200);

  }, 1800);
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
  console.log("[DM Mirror] History backlog sync stopped.");
}
