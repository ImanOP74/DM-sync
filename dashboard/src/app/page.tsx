"use client";

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Conversation, Message } from '@/types/database';
import { 
  Search, 
  MessageSquare, 
  ArrowLeft, 
  RefreshCw, 
  Send, 
  Smartphone, 
  Sparkles, 
  User, 
  Lock
} from 'lucide-react';

const InstagramIcon = ({ size = 20, className = "" }: { size?: number; className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
  </svg>
);


export default function DashboardPage() {
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

  // Refs for Scroll Control & Real-time Synchronization Closures
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeConversationIdRef = useRef<string | null>(null);

  // Update conversation ref when the active selection changes
  useEffect(() => {
    activeConversationIdRef.current = selectedConversation ? selectedConversation.id : null;
    if (selectedConversation) {
      loadMessages(selectedConversation.id);
    } else {
      setMessages([]);
    }
  }, [selectedConversation]);

  // Handle mobile width detection
  useEffect(() => {
    const handleResize = () => {
      setIsMobileView(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Fetch initial list of conversations
  useEffect(() => {
    fetchConversations();
  }, []);

  // Set up Single-Socket Real-time Subscriptions on Mount
  useEffect(() => {
    console.log("[Dashboard] Initializing Supabase Realtime channels...");

    // 1. Subscribe to updates/inserts on the conversations table
    const conversationChannel = supabase
      .channel('conversations-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        (payload) => {
          console.log("[Dashboard] Realtime Conversation Event Received:", payload);
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
              return [updatedConv, ...filtered]; // Move updated chat to the top
            });
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log("[Dashboard] Conversation channel active.");
          setSyncStatus('connected');
        } else {
          setSyncStatus('error');
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
          console.log("[Dashboard] Realtime Message Event Received:", newMsg);

          // Append message if it belongs to the currently active conversation
          if (newMsg.conversation_id === activeConversationIdRef.current) {
            setMessages(prev => {
              if (prev.some(m => m.id === newMsg.id || m.instagram_message_id === newMsg.instagram_message_id)) {
                return prev;
              }
              return [...prev, newMsg];
            });
          }

          // Move the conversation containing the new message to the top of the sidebar
          setConversations(prev => {
            const target = prev.find(c => c.id === newMsg.conversation_id);
            if (target) {
              const updatedTarget = { ...target, updated_at: newMsg.created_at };
              const filtered = prev.filter(c => c.id !== newMsg.conversation_id);
              return [updatedTarget, ...filtered];
            }
            return prev;
          });
        }
      )
      .subscribe();

    return () => {
      console.log("[Dashboard] Cleaning up Realtime channels...");
      supabase.removeChannel(conversationChannel);
      supabase.removeChannel(messageChannel);
    };
  }, []);

  // Auto-scroll to the bottom of the chat pane when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /**
   * Loads conversations sorted by recent activity
   */
  async function fetchConversations() {
    try {
      setIsLoadingConversations(true);
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .order('updated_at', { ascending: false });

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
   * Loads the message history for a chosen thread
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

  // Filter conversations based on search input
  const filteredConversations = conversations.filter(c => 
    c.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.instagram_thread_id.includes(searchQuery)
  );

  // Helper: Generates a reliable initials string
  const getInitials = (name: string | null) => {
    if (!name) return 'IG';
    return name.substring(0, 2).toUpperCase();
  };

  // Helper: Formats timestamp text nicely
  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
      return "Today";
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // Helper: Generates unique gradient avatars dynamically
  const getAvatarGradient = (id: string) => {
    const gradients = [
      'from-pink-500 to-rose-500',
      'from-purple-500 to-indigo-500',
      'from-violet-500 to-fuchsia-500',
      'from-blue-500 to-cyan-500',
      'from-teal-500 to-emerald-500'
    ];
    // Simple hash to select a stable gradient index
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % gradients.length;
    return gradients[index];
  };

  // UI Sections
  const showSidebar = !isMobileView || !selectedConversation;
  const showChatArea = !isMobileView || !!selectedConversation;

  return (
    <div className="flex h-screen bg-[#09090b] text-[#f4f4f5] overflow-hidden antialiased">
      
      {/* 1. SIDEBAR PANEL */}
      {showSidebar && (
        <div className="flex flex-col w-full md:w-80 border-r border-zinc-800 bg-[#09090b] h-full flex-shrink-0">
          
          {/* Header */}
          <div className="p-4 flex flex-col gap-4 border-b border-zinc-800">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-gradient-to-tr from-pink-500 via-red-500 to-yellow-500 rounded-lg">
                  <InstagramIcon size={20} className="text-white" />
                </div>
                <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-zinc-100 to-zinc-400 bg-clip-text text-transparent">
                  InstaSync
                </h1>
              </div>
              
              {/* Sync Status Badge */}
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${
                  syncStatus === 'connected' ? 'bg-emerald-500 animate-pulse' :
                  syncStatus === 'connecting' ? 'bg-amber-500 animate-pulse' : 'bg-rose-500'
                }`} />
                <span className="text-[10px] text-zinc-400 capitalize">
                  {syncStatus === 'connected' ? 'Live' : syncStatus}
                </span>
                <button 
                  onClick={fetchConversations} 
                  className="p-1 text-zinc-400 hover:text-zinc-100 transition-colors ml-1"
                  title="Reload list"
                >
                  <RefreshCw size={12} />
                </button>
              </div>
            </div>

            {/* Search Box */}
            <div className="relative">
              <input
                type="text"
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-700 transition-all text-[#f4f4f5]"
              />
              <Search className="absolute left-3 top-2.5 text-zinc-500" size={16} />
            </div>
          </div>

          {/* Conversation List */}
          <div className="flex-1 overflow-y-auto divide-y divide-zinc-900">
            {isLoadingConversations ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
                <span className="text-xs text-zinc-500">Loading chats...</span>
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-8 text-center">
                <MessageSquare className="mx-auto text-zinc-700 mb-2" size={32} />
                <p className="text-sm text-zinc-500">
                  {searchQuery ? 'No chats match search' : 'No conversations synced yet'}
                </p>
                {!searchQuery && (
                  <p className="text-xs text-zinc-600 mt-1">
                    Open a chat on Instagram with your sync extension enabled to start indexing.
                  </p>
                )}
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const isActive = selectedConversation?.id === conv.id;
                return (
                  <div
                    key={conv.id}
                    onClick={() => setSelectedConversation(conv)}
                    className={`flex items-center gap-3 p-4 cursor-pointer select-none transition-all ${
                      isActive 
                        ? 'bg-zinc-800/40 border-l-2 border-pink-500' 
                        : 'hover:bg-zinc-900/50'
                    }`}
                  >
                    {/* User Profile Avatar Circle */}
                    <div className={`flex items-center justify-center w-11 h-11 rounded-full bg-gradient-to-tr ${getAvatarGradient(conv.id)} text-white font-bold text-sm shadow-md`}>
                      {getInitials(conv.name)}
                    </div>

                    {/* Chat Text Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline mb-0.5">
                        <h3 className="font-semibold text-sm truncate text-zinc-100">
                          {conv.name || `User ${conv.instagram_thread_id.substring(0, 8)}`}
                        </h3>
                        <span className="text-[10px] text-zinc-500 whitespace-nowrap">
                          {formatDate(conv.updated_at)}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 truncate">
                        ID: {conv.instagram_thread_id}
                      </p>
                      <div className="flex items-center gap-1 mt-1">
                        <span className="inline-block w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                        <span className="text-[9px] text-zinc-500 tracking-wide uppercase">Sync Active</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* 2. CHAT HISTORY AREA */}
      {showChatArea && (
        <div className="flex-1 flex flex-col bg-zinc-950 h-full relative">
          
          {selectedConversation ? (
            <>
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-[#09090b]/80 backdrop-blur-md sticky top-0 z-10">
                <div className="flex items-center gap-3">
                  {/* Mobile Back Arrow */}
                  {isMobileView && (
                    <button 
                      onClick={() => setSelectedConversation(null)}
                      className="p-1 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-100 transition-colors"
                    >
                      <ArrowLeft size={20} />
                    </button>
                  )}
                  
                  {/* Initials Icon */}
                  <div className={`flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-tr ${getAvatarGradient(selectedConversation.id)} text-white font-semibold text-xs shadow-md`}>
                    {getInitials(selectedConversation.name)}
                  </div>
                  
                  {/* Details */}
                  <div>
                    <h2 className="font-semibold text-sm text-zinc-100">
                      {selectedConversation.name || 'Conversation Detail'}
                    </h2>
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                      <span className="text-[10px] text-zinc-400">
                        Instagram ID: {selectedConversation.instagram_thread_id}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Additional Info Box */}
                <div className="hidden sm:flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 px-3 py-1 rounded-full text-xs text-zinc-400">
                  <Sparkles size={12} className="text-yellow-500" />
                  <span>Real-time Live Sync</span>
                </div>
              </div>

              {/* Messages Pane */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900/10 via-zinc-950 to-zinc-950">
                {isLoadingMessages ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2">
                    <div className="w-6 h-6 border-2 border-zinc-800 border-t-zinc-400 rounded-full animate-spin" />
                    <span className="text-xs text-zinc-500">Loading conversation history...</span>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center p-8">
                    <MessageSquare className="text-zinc-800 mb-2" size={48} />
                    <p className="text-sm text-zinc-400 font-medium">No messages synchronized yet</p>
                    <p className="text-xs text-zinc-600 max-w-xs mt-1">
                      New messages sent or received in this Instagram thread will sync here instantly.
                    </p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isMe = msg.sender_id === 'me';
                    return (
                      <div 
                        key={msg.id} 
                        className={`flex flex-col w-full ${isMe ? 'items-end' : 'items-start'}`}
                      >
                        {/* Sender Label (Optional, shown in groups) */}
                        {!isMe && selectedConversation.is_group && (
                          <span className="text-[10px] text-zinc-500 ml-2 mb-0.5">
                            {msg.sender_username || 'other'}
                          </span>
                        )}

                        {/* Bubble */}
                        <div 
                          className={`max-w-[80%] sm:max-w-[70%] rounded-2xl px-4 py-2 text-sm shadow-md break-words whitespace-pre-wrap leading-relaxed transition-all ${
                            isMe 
                              ? 'bg-violet-600 text-white rounded-br-none' 
                              : 'bg-zinc-800 text-zinc-100 rounded-bl-none border border-zinc-700/30'
                          }`}
                        >
                          {msg.text}
                        </div>

                        {/* Timing */}
                        <span className="text-[9px] text-zinc-500 mt-1 mx-2">
                          {formatTime(msg.created_at)}
                        </span>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Sync Only Footer (Looks like standard Chat Bar input for consistency) */}
              <div className="p-4 bg-[#09090b]/80 border-t border-zinc-800 backdrop-blur-md flex items-center gap-3">
                <div className="flex-1 flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 select-none text-zinc-500 text-xs italic">
                  <Lock size={12} className="text-zinc-600 flex-shrink-0" />
                  <span className="truncate">Read-only synchronized dashboard. Replying from here is disabled. Respond via Instagram.</span>
                </div>
                <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-600 select-none">
                  <Send size={16} />
                </div>
              </div>
            </>
          ) : (
            // No Selected Chat - Display Welcome Pane
            <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-zinc-900/30 via-zinc-950 to-zinc-950">
              <div className="max-w-md text-center flex flex-col items-center gap-6">
                
                {/* Branding Circle */}
                <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-pink-500 via-red-500 to-yellow-500 flex items-center justify-center shadow-xl animate-pulse">
                  <InstagramIcon size={40} className="text-white" />
                </div>

                <div className="space-y-2">
                  <h2 className="text-2xl font-bold tracking-tight text-zinc-100">
                    Your Instagram DM Sync Hub
                  </h2>
                  <p className="text-sm text-zinc-400 leading-relaxed max-w-sm mx-auto">
                    Select a synchronized conversation from the sidebar list to view real-time chat histories, messages, and sender information.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 w-full mt-4">
                  <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl text-left flex flex-col gap-1">
                    <Sparkles size={16} className="text-pink-500" />
                    <span className="text-xs font-semibold text-zinc-300">Live Listening</span>
                    <span className="text-[10px] text-zinc-500">Supabase sockets sync arrivals immediately.</span>
                  </div>
                  <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl text-left flex flex-col gap-1">
                    <Smartphone size={16} className="text-violet-500" />
                    <span className="text-xs font-semibold text-zinc-300">Mobile Ready</span>
                    <span className="text-[10px] text-zinc-500">Fully responsive viewport navigation.</span>
                  </div>
                </div>

                <div className="text-[10px] text-zinc-600 flex items-center gap-1.5 mt-2">
                  <Lock size={10} />
                  <span>Secure read-only Postgres replication channel</span>
                </div>

              </div>
            </div>
          )}

        </div>
      )}

    </div>
  );
}
