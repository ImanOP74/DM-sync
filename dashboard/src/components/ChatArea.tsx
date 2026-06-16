import React, { useRef, useEffect } from 'react';
import { Conversation, Message } from '@/types/database';
import { ArrowLeft, Sparkles, MessageSquare, Lock, Send } from 'lucide-react';

interface ChatAreaProps {
  selectedConversation: Conversation;
  messages: Message[];
  isLoadingMessages: boolean;
  isMobileView: boolean;
  onBack: () => void;
}

export default function ChatArea({
  selectedConversation,
  messages,
  isLoadingMessages,
  isMobileView,
  onBack
}: ChatAreaProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom of the chat pane when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const getInitials = (name: string | null) => {
    if (!name) return 'IG';
    return name.substring(0, 2).toUpperCase();
  };

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const getAvatarGradient = (id: string) => {
    const gradients = [
      'from-pink-500 to-rose-500',
      'from-purple-500 to-indigo-500',
      'from-violet-500 to-fuchsia-500',
      'from-blue-500 to-cyan-500',
      'from-teal-500 to-emerald-500'
    ];
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % gradients.length;
    return gradients[index];
  };

  return (
    <div className="flex-1 flex flex-col bg-zinc-950 h-full relative">
      
      {/* Active Conversation Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-[#09090b]/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          {/* Back button shown on mobile only */}
          {isMobileView && (
            <button 
              onClick={onBack}
              className="p-1 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
          )}
          
          {/* Header Profile Image / Avatar */}
          {selectedConversation.avatar_url ? (
            <img 
              src={selectedConversation.avatar_url} 
              alt={selectedConversation.conversation_name || 'Profile avatar'} 
              className="w-10 h-10 rounded-full object-cover shadow-md border border-zinc-800"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className={`flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-tr ${getAvatarGradient(selectedConversation.id)} text-white font-semibold text-xs shadow-md`}>
              {getInitials(selectedConversation.conversation_name)}
            </div>
          )}
          
          <div>
            <h2 className="font-semibold text-sm text-zinc-100">
              {selectedConversation.conversation_name || 'Conversation Detail'}
            </h2>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-[10px] text-zinc-400">
                Instagram ID: {selectedConversation.conversation_id}
              </span>
            </div>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 px-3 py-1 rounded-full text-xs text-zinc-400">
          <Sparkles size={12} className="text-yellow-500" />
          <span>Real-time Live Sync</span>
        </div>
      </div>

      {/* Messages Viewer Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900/10 via-zinc-950 to-zinc-950">
        {isLoadingMessages ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <div className="w-6 h-6 border-2 border-zinc-800 border-t-zinc-400 rounded-full animate-spin" />
            <span className="text-xs text-zinc-500">Loading conversation history...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <MessageSquare className="text-zinc-800 mb-2" size={48} />
            <p className="text-sm text-zinc-400 font-medium">No messages mirrored yet</p>
            <p className="text-xs text-zinc-600 max-w-xs mt-1">
              New messages synced by the extension for this conversation will appear here instantly.
            </p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isMe = msg.sent_by_me;
            
            // Show sender name/username above message bubble when the sender changes
            const showSenderName = !isMe && (
              index === 0 || 
              messages[index - 1].sent_by_me || 
              messages[index - 1].sender_name !== msg.sender_name
            );

            return (
              <div 
                key={msg.id} 
                className={`flex flex-col w-full ${isMe ? 'items-end' : 'items-start'}`}
              >
                {showSenderName && (
                  <span className="text-[10px] text-zinc-500 font-semibold ml-2 mb-1 tracking-wide">
                    {msg.sender_username || msg.sender_name || 'other'}
                  </span>
                )}

                <div 
                  className={`max-w-[80%] sm:max-w-[70%] rounded-2xl px-4 py-2 text-sm shadow-md break-words whitespace-pre-wrap leading-relaxed transition-all ${
                    isMe 
                      ? 'bg-violet-600 text-white rounded-br-none' 
                      : 'bg-zinc-800 text-zinc-100 rounded-bl-none border border-zinc-700/30'
                  }`}
                >
                  {msg.content}
                </div>

                <span className="text-[9px] text-zinc-500 mt-1 mx-2">
                  {formatTime(msg.timestamp)}
                </span>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Sync Only Warning Bar (Looks like chat input for UI consistency) */}
      <div className="p-4 bg-[#09090b]/80 border-t border-zinc-800 backdrop-blur-md flex items-center gap-3">
        <div className="flex-1 flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 select-none text-zinc-500 text-xs italic">
          <Lock size={12} className="text-zinc-600 flex-shrink-0" />
          <span className="truncate">Read-only mirrored dashboard. Replying is disabled. Respond via Instagram.</span>
        </div>
        <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-600 select-none">
          <Send size={16} />
        </div>
      </div>

    </div>
  );
}
