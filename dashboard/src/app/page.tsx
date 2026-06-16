"use client";

import React, { useState, useEffect, useRef } from 'react';
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
  
  // UI States
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'connected' | 'error' | 'connecting'>('connecting');

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
          }

          // Trigger a quick reorder on the conversations list
          setConversations(prev => {
            const target = prev.find(c => c.conversation_id === newMsg.conversation_id);
            if (target) {
              const updatedTarget = { 
                ...target, 
                updated_at: newMsg.timestamp,
                last_message: newMsg.content
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
   * Queries conversations with optional filter.
   */
  async function fetchConversations(queryText = '') {
    try {
      setIsLoadingConversations(true);
      
      let query = supabase
        .from('conversations')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(30);

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
   * Loads the message history for a chosen thread, limited to the last 100 messages.
   * Directly queries using the native TEXT conversation_id.
   */
  async function loadMessages(conversationId: string) {
    try {
      setIsLoadingMessages(true);
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('timestamp', { ascending: true }) // Sorted chronologically
        .limit(100);

      if (error) throw error;
      setMessages(data || []);
    } catch (err) {
      console.error("[Dashboard] Error loading messages:", err);
    } finally {
      setIsLoadingMessages(false);
    }
  }

  // Handle manual reload trigger
  const handleRefresh = () => {
    fetchConversations(searchQuery);
    if (selectedConversation) {
      loadMessages(selectedConversation.conversation_id);
    }
  };

  // If there is exactly one conversation, we hide the sidebar to provide a clean full-screen view.
  // Otherwise, we show the sidebar for selection/search.
  const showSidebar = (conversations.length === 0 || conversations.length > 1) && (!isMobileView || !selectedConversation);
  const showChatArea = conversations.length === 1 || !isMobileView || !!selectedConversation;

  return (
    <div className="flex h-screen bg-[#09090b] text-[#f4f4f5] overflow-hidden antialiased">
      
      {/* 1. SIDEBAR LIST */}
      {showSidebar && (
        <Sidebar
          conversations={conversations}
          selectedConversation={selectedConversation}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelectConversation={setSelectedConversation}
          isLoadingConversations={isLoadingConversations}
          syncStatus={syncStatus}
          onRefresh={handleRefresh}
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
            />
          ) : (
            <EmptyState />
          )}
        </>
      )}

    </div>
  );
}
