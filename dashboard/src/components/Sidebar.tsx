import React from 'react';
import { Conversation } from '@/types/database';
import { Search, RefreshCw, MessageSquare } from 'lucide-react';

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

interface SidebarProps {
  conversations: Conversation[];
  selectedConversation: Conversation | null;
  searchQuery: string;
  onSearchChange: (val: string) => void;
  onSelectConversation: (conv: Conversation) => void;
  isLoadingConversations: boolean;
  syncStatus: 'connected' | 'error' | 'connecting';
  onRefresh: () => void;
}

export default function Sidebar({
  conversations,
  selectedConversation,
  searchQuery,
  onSearchChange,
  onSelectConversation,
  isLoadingConversations,
  syncStatus,
  onRefresh
}: SidebarProps) {

  const getInitials = (name: string | null) => {
    if (!name) return 'IG';
    return name.substring(0, 2).toUpperCase();
  };

  const formatDate = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const today = new Date();
      if (date.toDateString() === today.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
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
    <div className="flex flex-col w-full md:w-80 border-r border-zinc-800 bg-[#09090b] h-full flex-shrink-0">
      
      {/* Sidebar Header */}
      <div className="p-4 flex flex-col gap-4 border-b border-zinc-800">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-gradient-to-tr from-pink-500 via-red-500 to-yellow-500 rounded-lg">
              <InstagramIcon size={20} className="text-white" />
            </div>
            <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-zinc-100 to-zinc-400 bg-clip-text text-transparent">
              DM Mirror
            </h1>
          </div>
          
          {/* Status Indicators */}
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${
              syncStatus === 'connected' ? 'bg-emerald-500 animate-pulse' :
              syncStatus === 'connecting' ? 'bg-amber-500 animate-pulse' : 'bg-rose-500'
            }`} />
            <span className="text-[10px] text-zinc-400 capitalize">
              {syncStatus === 'connected' ? 'Live' : syncStatus}
            </span>
            <button 
              onClick={onRefresh} 
              className="p-1 text-zinc-400 hover:text-zinc-100 transition-colors ml-1"
              title="Reload list"
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </div>

        {/* Search Input Box */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-700 transition-all text-[#f4f4f5]"
          />
          <Search className="absolute left-3 top-2.5 text-zinc-500" size={16} />
        </div>
      </div>

      {/* Conversation Thread List */}
      <div className="flex-1 overflow-y-auto divide-y divide-zinc-900">
        {isLoadingConversations ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
            <span className="text-xs text-zinc-500">Loading chats...</span>
          </div>
        ) : conversations.length === 0 ? (
          <div className="p-8 text-center">
            <MessageSquare className="mx-auto text-zinc-700 mb-2" size={32} />
            <p className="text-sm text-zinc-500">
              {searchQuery ? 'No chats match search' : 'No conversations synced yet'}
            </p>
            {!searchQuery && (
              <p className="text-xs text-zinc-600 mt-1">
                Open a chat on Instagram with your sync extension enabled to start mirroring.
              </p>
            )}
          </div>
        ) : (
          conversations.map((conv) => {
            const isActive = selectedConversation?.id === conv.id;
            return (
              <div
                key={conv.id}
                onClick={() => onSelectConversation(conv)}
                className={`flex items-center gap-3 p-4 cursor-pointer select-none transition-all ${
                  isActive 
                    ? 'bg-zinc-800/40 border-l-2 border-pink-500' 
                    : 'hover:bg-zinc-900/50'
                }`}
              >
                {/* Profile Circle / Avatar Image */}
                {conv.avatar_url ? (
                  <img 
                    src={conv.avatar_url} 
                    alt={conv.conversation_name || 'Profile avatar'} 
                    className="w-11 h-11 rounded-full object-cover shadow-md flex-shrink-0 border border-zinc-800"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className={`flex items-center justify-center w-11 h-11 rounded-full bg-gradient-to-tr ${getAvatarGradient(conv.id)} text-white font-bold text-sm shadow-md flex-shrink-0`}>
                    {getInitials(conv.conversation_name)}
                  </div>
                )}

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline mb-0.5">
                    <h3 className="font-semibold text-sm truncate text-zinc-100">
                      {conv.conversation_name || `User ${conv.conversation_id.substring(0, 8)}`}
                    </h3>
                    <span className="text-[10px] text-zinc-500 whitespace-nowrap">
                      {formatDate(conv.updated_at)}
                    </span>
                  </div>
                  
                  {/* Caching preview */}
                  <p className="text-xs text-zinc-400 truncate pr-2">
                    {conv.last_message ? (
                      <span className="text-zinc-300">
                        {conv.last_message}
                      </span>
                    ) : (
                      `ID: ${conv.conversation_id}`
                    )}
                  </p>
                  
                  <div className="flex items-center gap-1 mt-1">
                    <span className="inline-block w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                    <span className="text-[9px] text-zinc-500 tracking-wide uppercase">Active</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

    </div>
  );
}
