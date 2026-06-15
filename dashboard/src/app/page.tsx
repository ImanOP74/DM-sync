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

  // Refs for tracking connection state & synchronization closures
  const activeConversationIdRef = useRef<string | null>(null);
  const isFirstLoad = useRef(true);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Synchronize active conversation ID with a ref to avoid stale closures in realtime callbacks
  useEffect(() => {
    activeConversationIdRef.current = selectedConversation ? selectedConversation.id : null;
    if (selectedConversation) {
      loadMessages(selectedConversation.id);
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
    fetchConversations();
  }, []);

  // Debounce search query to avoid spamming Supabase API on every keystroke
  useEffect(() => {
    // Skip debounce on mount
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
              if (prev.some(c => c.id === newConv.id)) return prev;
              return [newConv, ...prev];
            });
          } else if (payload.eventType === 'UPDATE') {
            const updatedConv = payload.new as Conversation;
            setConversations(prev => {
              const filtered = prev.filter(c => c.id !== updatedConv.id);
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
          // to make sure we didn't miss any uploads while the socket was offline.
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
              if (prev.some(m => m.id === newMsg.id || m.instagram_message_id === newMsg.instagram_message_id)) {
                return prev;
              }
              return [...prev, newMsg];
            });
          }

          // Trigger a quick reorder on the conversations list
          setConversations(prev => {
            const target = prev.find(c => c.id === newMsg.conversation_id);
            if (target) {
              const updatedTarget = { 
                ...target, 
                updated_at: newMsg.created_at,
                last_message_preview: newMsg.text,
                last_message_sender_id: newMsg.sender_id,
                last_message_time: newMsg.created_at
              };
              const filtered = prev.filter(c => c.id !== newMsg.conversation_id);
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
   * Uses server-side sorting and clamps results limit for scalability.
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
        query = query.or(`name.ilike.%${queryText}%,instagram_thread_id.like.%${queryText}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      setConversations(data || []);
    } catch (err) {
      console.error("[Dashboard] Error fetching conversations:", err);
      setSyncStatus('error');
    } finally {
      setIsLoadingConversations(false);
    }
  }

  /**
   * Loads the message history for a chosen thread, limited to the last 100 messages.
   */
  async function loadMessages(conversationId: string) {
    try {
      setIsLoadingMessages(true);
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
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
      loadMessages(selectedConversation.id);
    }
  };

  const showSidebar = !isMobileView || !selectedConversation;
  const showChatArea = !isMobileView || !!selectedConversation;

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
