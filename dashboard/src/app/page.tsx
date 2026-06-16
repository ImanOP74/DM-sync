"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Conversation, Message } from '@/types/database';
import Sidebar from '@/components/Sidebar';
import ChatArea from '@/components/ChatArea';
import EmptyState from '@/components/EmptyState';

export default function DashboardHub() {
  // Core State
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'pinned' | 'unread'>('all');
  
  // UI States
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'connected' | 'error' | 'connecting'>('connecting');

  // Pagination states
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Refs for tracking connection state & synchronization closures (tracked by native string conversation_id)
  const activeConversationIdRef = useRef<string | null>(null);
  const isFirstLoad = useRef(true);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Synchronize active conversation ID with a ref to avoid stale closures in realtime callbacks
  useEffect(() => {
    activeConversationIdRef.current = selectedConversation ? selectedConversation.conversation_id : null;
    if (selectedConversation) {
      loadMessages(selectedConversation.conversation_id);
    } else {
      setMessages([]);
      setHasMore(false);
    }
  }, [selectedConversation]);

  // Responsive mobile width listener
  useEffect(() => {
    const handleResize = () => {
      setIsMobileView(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Fetch initial conversations list on mount
  useEffect(() => {
    fetchConversations().then(convs => {
      if (convs && convs.length > 0 && !selectedConversation) {
        setSelectedConversation(convs[0]);
      }
    });
  }, []);

  // Debounce search query to avoid spamming Supabase API on every keystroke
  useEffect(() => {
    if (isFirstLoad.current) return;

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      fetchConversations(searchQuery);
    }, 400);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery]);

  // Set up Single-socket Supabase Realtime Channels
  useEffect(() => {
    console.log("[Dashboard] Initializing Supabase Realtime channels...");

    // 1. Subscribe to updates/inserts on the conversations table
    const conversationChannel = supabase
      .channel('conversations-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        (payload) => {
          console.log("[Dashboard] Realtime Conversation Update:", payload);
          if (payload.eventType === 'INSERT') {
            const newConv = payload.new as Conversation;
            setConversations(prev => {
              if (prev.some(c => c.conversation_id === newConv.conversation_id)) return prev;
              const nextList = [newConv, ...prev];
              // Auto-select conversation if it's the first one synced
              if (nextList.length === 1) {
                setSelectedConversation(newConv);
              }
              return nextList;
            });
          } else if (payload.eventType === 'UPDATE') {
            const updatedConv = payload.new as Conversation;
            setConversations(prev => {
              const filtered = prev.filter(c => c.conversation_id !== updatedConv.conversation_id);
              return [updatedConv, ...filtered]; // Sort updated to the top
            });
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log("[Dashboard] Realtime WebSocket connected.");
          setSyncStatus('connected');

          // WebSocket Gap Recovery: If this is a reconnection, pull latest data from DB
          if (!isFirstLoad.current) {
            console.log("[Dashboard] WebSocket reconnected. Synchronizing state gaps...");
            fetchConversations(searchQuery);
            if (activeConversationIdRef.current) {
              loadMessages(activeConversationIdRef.current);
            }
          } else {
            isFirstLoad.current = false;
          }
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          console.warn("[Dashboard] WebSocket connection lost. Reconnecting...");
          setSyncStatus('connecting');
        }
      });

    // 2. Subscribe to insert events on the messages table
    const messageChannel = supabase
      .channel('messages-db-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const newMsg = payload.new as Message;
          console.log("[Dashboard] Realtime Message Inserted:", newMsg);

          // Append message if it belongs to the currently active conversation
          if (newMsg.conversation_id === activeConversationIdRef.current) {
            setMessages(prev => {
              if (prev.some(m => m.id === newMsg.id || m.message_hash === newMsg.message_hash)) {
                return prev;
              }
              return [...prev, newMsg];
            });
          } else {
            // Mark other conversation as unread locally
            setConversations(prev => prev.map(c => 
              c.conversation_id === newMsg.conversation_id ? { ...c, is_unread: true } : c
            ));
          }

          // Trigger a quick reorder on the conversations list
          setConversations(prev => {
            const target = prev.find(c => c.conversation_id === newMsg.conversation_id);
            if (target) {
              const updatedTarget = { 
                ...target, 
                updated_at: newMsg.timestamp,
                last_message: newMsg.content,
                is_unread: newMsg.conversation_id !== activeConversationIdRef.current ? true : target.is_unread
              };
              const filtered = prev.filter(c => c.conversation_id !== newMsg.conversation_id);
              return [updatedTarget, ...filtered];
            }
            return prev;
          });
        }
      )
      .subscribe();

    return () => {
      console.log("[Dashboard] Tearing down Realtime channels...");
      supabase.removeChannel(conversationChannel);
      supabase.removeChannel(messageChannel);
    };
  }, [searchQuery]);

  /**
   * Queries conversations.
   */
  async function fetchConversations(queryText = '') {
    try {
      setIsLoadingConversations(true);
      
      let query = supabase
        .from('conversations')
        .select('*')
        .limit(100);

      // Perform server-side search if text is provided
      if (queryText.trim()) {
        query = query.or(`conversation_name.ilike.%${queryText}%,conversation_id.like.%${queryText}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      setConversations(data || []);
      return data || [];
    } catch (err) {
      console.error("[Dashboard] Error fetching conversations:", err);
      setSyncStatus('error');
      return [];
    } finally {
      setIsLoadingConversations(false);
    }
  }

  /**
   * Loads the message history for a chosen thread, limited to the last 50 messages initially.
   * Directly queries using the native TEXT conversation_id.
   */
  async function loadMessages(conversationId: string) {
    try {
      setIsLoadingMessages(true);
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('timestamp', { ascending: false }) // Load newest first for pagination
        .limit(50);

      if (error) throw error;
      const sorted = (data || []).reverse(); // Render chronologically
      setMessages(sorted);
      setHasMore((data || []).length === 50);
    } catch (err) {
      console.error("[Dashboard] Error loading messages:", err);
    } finally {
      setIsLoadingMessages(false);
    }
  }

  /**
   * Loads older messages (backward cursor pagination).
   */
  const handleLoadMore = async () => {
    if (!selectedConversation || messages.length === 0 || isLoadingMore || !hasMore) return;
    
    try {
      setIsLoadingMore(true);
      const oldestMsg = messages[0];
      
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', selectedConversation.conversation_id)
        .lt('timestamp', oldestMsg.timestamp)
        .order('timestamp', { ascending: false })
        .limit(50);
        
      if (error) throw error;
      
      if (data && data.length > 0) {
        const reversedNewData = [...data].reverse();
        setMessages(prev => [...reversedNewData, ...prev]);
        setHasMore(data.length === 50);
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.error("[Dashboard] Failed to load older messages:", err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  /**
   * Updates bookmark state.
   */
  const handleToggleBookmark = async (msg: Message) => {
    const nextBookmark = !msg.is_bookmarked;
    setMessages(prev => prev.map(m => 
      m.id === msg.id ? { ...m, is_bookmarked: nextBookmark } : m
    ));
    
    const { error } = await supabase
      .from('messages')
      .update({ is_bookmarked: nextBookmark })
      .eq('id', msg.id);
      
    if (error) {
      console.error("Failed to update bookmark in Supabase:", error);
      // Rollback
      setMessages(prev => prev.map(m => 
        m.id === msg.id ? { ...m, is_bookmarked: !nextBookmark } : m
      ));
    }
  };

  /**
   * Updates pinned status of conversation.
   */
  const handleTogglePin = async (conv: Conversation) => {
    const nextPinned = !conv.is_pinned;
    setConversations(prev => prev.map(c => 
      c.conversation_id === conv.conversation_id ? { ...c, is_pinned: nextPinned } : c
    ));
    if (selectedConversation?.conversation_id === conv.conversation_id) {
      setSelectedConversation(prev => prev ? { ...prev, is_pinned: nextPinned } : null);
    }
    
    const { error } = await supabase
      .from('conversations')
      .update({ is_pinned: nextPinned })
      .eq('conversation_id', conv.conversation_id);
      
    if (error) {
      console.error("Failed to pin conversation:", error);
      setConversations(prev => prev.map(c => 
        c.conversation_id === conv.conversation_id ? { ...c, is_pinned: !nextPinned } : c
      ));
    }
  };

  /**
   * Updates unread status of conversation.
   */
  const handleToggleUnread = async (conv: Conversation) => {
    const nextUnread = !conv.is_unread;
    setConversations(prev => prev.map(c => 
      c.conversation_id === conv.conversation_id ? { ...c, is_unread: nextUnread } : c
    ));
    if (selectedConversation?.conversation_id === conv.conversation_id) {
      setSelectedConversation(prev => prev ? { ...prev, is_unread: nextUnread } : null);
    }
    
    const { error } = await supabase
      .from('conversations')
      .update({ is_unread: nextUnread })
      .eq('conversation_id', conv.conversation_id);
      
    if (error) {
      console.error("Failed to toggle unread status:", error);
      setConversations(prev => prev.map(c => 
        c.conversation_id === conv.conversation_id ? { ...c, is_unread: !nextUnread } : c
      ));
    }
  };

  /**
   * Handles selection of a thread, automatically clearing the unread flag.
   */
  const handleSelectConversation = async (conv: Conversation) => {
    setSelectedConversation(conv);
    
    if (conv.is_unread) {
      setConversations(prev => prev.map(c => 
        c.conversation_id === conv.conversation_id ? { ...c, is_unread: false } : c
      ));
      await supabase
        .from('conversations')
        .update({ is_unread: false })
        .eq('conversation_id', conv.conversation_id);
    }
  };

  // Manual refresh hook
  const handleRefresh = () => {
    fetchConversations(searchQuery);
    if (selectedConversation) {
      loadMessages(selectedConversation.conversation_id);
    }
  };

  // Locally filtered & sorted conversation threads (Pinned first, then sorted by activity date)
  const filteredConversations = useMemo(() => {
    let result = [...conversations];
    
    if (filterType === 'pinned') {
      result = result.filter(c => c.is_pinned);
    } else if (filterType === 'unread') {
      result = result.filter(c => c.is_unread);
    }
    
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c => 
        (c.conversation_name && c.conversation_name.toLowerCase().includes(q)) || 
        c.conversation_id.toLowerCase().includes(q)
      );
    }
    
    result.sort((a, b) => {
      if (a.is_pinned && !b.is_pinned) return -1;
      if (!a.is_pinned && b.is_pinned) return 1;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    
    return result;
  }, [conversations, filterType, searchQuery]);

  // Global keyboard listener for conversation switching (Alt + Up / Alt + Down) and Esc deselect
  useEffect(() => {
    const handleSwitchConversations = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        if (filteredConversations.length === 0) return;
        
        let nextIndex = 0;
        if (selectedConversation) {
          const currentIndex = filteredConversations.findIndex(c => c.conversation_id === selectedConversation.conversation_id);
          if (currentIndex !== -1) {
            if (e.key === 'ArrowDown') {
              nextIndex = (currentIndex + 1) % filteredConversations.length;
            } else {
              nextIndex = (currentIndex - 1 + filteredConversations.length) % filteredConversations.length;
            }
          }
        }
        
        handleSelectConversation(filteredConversations[nextIndex]);
      }
      
      if (e.key === 'Escape' && selectedConversation && isMobileView) {
        setSelectedConversation(null);
      }
    };
    
    window.addEventListener('keydown', handleSwitchConversations);
    return () => window.removeEventListener('keydown', handleSwitchConversations);
  }, [filteredConversations, selectedConversation, isMobileView]);

  // Responsive panel layouts
  const showSidebar = (conversations.length === 0 || conversations.length > 1) && (!isMobileView || !selectedConversation);
  const showChatArea = conversations.length === 1 || !isMobileView || !!selectedConversation;

  return (
    <div className="flex h-screen bg-black text-zinc-100 overflow-hidden antialiased">
      
      {/* 1. SIDEBAR PANEL */}
      {showSidebar && (
        <Sidebar
          conversations={filteredConversations}
          selectedConversation={selectedConversation}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelectConversation={handleSelectConversation}
          isLoadingConversations={isLoadingConversations}
          syncStatus={syncStatus}
          onRefresh={handleRefresh}
          onTogglePin={handleTogglePin}
          onToggleUnread={handleToggleUnread}
          filterType={filterType}
          onFilterTypeChange={setFilterType}
        />
      )}

      {/* 2. CHAT VIEWPORT */}
      {showChatArea && (
        <>
          {selectedConversation ? (
            <ChatArea
              selectedConversation={selectedConversation}
              messages={messages}
              isLoadingMessages={isLoadingMessages}
              isMobileView={isMobileView}
              onBack={() => setSelectedConversation(null)}
              onToggleBookmark={handleToggleBookmark}
              onLoadMore={handleLoadMore}
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
            />
          ) : (
            <EmptyState />
          )}
        </>
      )}

    </div>
  );
}
