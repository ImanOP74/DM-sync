import React, { useState } from 'react';
import { Conversation } from '@/types/database';
import { Search, RefreshCw, MessageSquare, Pin, Check, EyeOff, Eye } from 'lucide-react';

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
  onTogglePin: (conv: Conversation) => void;
  onToggleUnread: (conv: Conversation) => void;
  filterType: 'all' | 'pinned' | 'unread';
  onFilterTypeChange: (type: 'all' | 'pinned' | 'unread') => void;
}

export default function Sidebar({
  conversations,
  selectedConversation,
  searchQuery,
  onSearchChange,
  onSelectConversation,
  isLoadingConversations,
  syncStatus,
  onRefresh,
  onTogglePin,
  onToggleUnread,
  filterType,
  onFilterTypeChange
}: SidebarProps) {

  const getInitials = (name: string | null) => {
    if (!name) return 'IG';
    return name.substring(0, 2).toUpperCase();
  };

  const formatDateShorthand = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffHrs = diffMs / (1000 * 60 * 60);

      if (diffHrs < 24 && date.getDate() === now.getDate()) {
        return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      }

      const diffDays = Math.floor(diffHrs / 24);
      if (diffDays < 7) {
        return `${diffDays || 1}d`;
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
    <div className="flex flex-col w-full md:w-[350px] border-r border-zinc-800 bg-black h-full flex-shrink-0">
      
      {/* Sidebar Header */}
      <div className="p-5 flex flex-col gap-4 border-b border-zinc-800 bg-black/90 sticky top-0 z-20">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-gradient-to-tr from-pink-600 via-purple-600 to-yellow-500 rounded-xl shadow-lg">
              <InstagramIcon size={18} className="text-white" />
            </div>
            <h1 className="text-md font-bold tracking-tight text-zinc-100">
              DM Mirror
            </h1>
          </div>
          
          {/* Live Sync Status */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800/80 px-2 py-0.5 rounded-full">
              <span className={`w-1.5 h-1.5 rounded-full ${
                syncStatus === 'connected' ? 'bg-emerald-500 animate-pulse' :
                syncStatus === 'connecting' ? 'bg-amber-500 animate-pulse' : 'bg-rose-500'
              }`} />
              <span className="text-[9px] text-zinc-400 font-semibold tracking-wider uppercase">
                {syncStatus === 'connected' ? 'Live' : syncStatus}
              </span>
            </div>
            <button 
              onClick={onRefresh} 
              className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 rounded-lg transition-all"
              title="Refresh inbox"
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </div>

        {/* Search Input */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-850 rounded-xl text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-700 transition-all text-zinc-100 font-medium"
          />
          <Search className="absolute left-3 top-2.5 text-zinc-500" size={15} />
        </div>

        {/* Filter Pills */}
        <div className="flex gap-2">
          {(['all', 'pinned', 'unread'] as const).map((type) => (
            <button
              key={type}
              onClick={() => onFilterTypeChange(type)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold select-none capitalize transition-all ${
                filterType === type
                  ? 'bg-zinc-100 text-black shadow-md shadow-white/5'
                  : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-zinc-200'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Conversation Thread List */}
      <div className="flex-1 overflow-y-auto divide-y divide-zinc-900/60 scrollbar-thin">
        {isLoadingConversations ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-350 rounded-full animate-spin" />
            <span className="text-xs font-medium text-zinc-500">Retrieving chats...</span>
          </div>
        ) : conversations.length === 0 ? (
          <div className="p-8 text-center mt-8">
            <MessageSquare className="mx-auto text-zinc-800 mb-3" size={36} />
            <p className="text-sm font-semibold text-zinc-400">
              {searchQuery ? 'No matched conversations' : `No ${filterType !== 'all' ? filterType : ''} chats found`}
            </p>
            <p className="text-xs text-zinc-650 mt-1.5 max-w-[200px] mx-auto leading-relaxed">
              {searchQuery ? 'Try matching username details.' : 'Sync inbox conversations using the chrome extension.'}
            </p>
          </div>
        ) : (
          conversations.map((conv) => {
            const isActive = selectedConversation?.conversation_id === conv.conversation_id;
            return (
              <div
                key={conv.conversation_id}
                className={`group flex items-center justify-between p-4 cursor-pointer select-none transition-all relative ${
                  isActive 
                    ? 'bg-zinc-900/50' 
                    : 'hover:bg-zinc-900/25'
                }`}
                onClick={() => onSelectConversation(conv)}
              >
                {/* Left: Avatar & Text details */}
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  
                  {/* Profile Image / Avatar */}
                  <div className="relative flex-shrink-0">
                    {conv.avatar_url ? (
                      <img 
                        src={conv.avatar_url} 
                        alt={conv.conversation_name || 'Avatar'} 
                        className="w-12 h-12 rounded-full object-cover shadow-sm flex-shrink-0 border border-zinc-800/80"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className={`flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-tr ${getAvatarGradient(conv.conversation_id)} text-white font-bold text-sm shadow-sm flex-shrink-0`}>
                        {getInitials(conv.conversation_name)}
                      </div>
                    )}
                    {/* Unread badge on avatar for mobile */}
                    {conv.is_unread && (
                      <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-sky-500 rounded-full border-2 border-black" />
                    )}
                  </div>

                  {/* Text labels */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between mb-0.5">
                      <h3 className={`font-semibold text-sm truncate leading-snug ${
                        conv.is_unread ? 'text-zinc-50 font-bold' : 'text-zinc-300'
                      }`}>
                        {conv.conversation_name || `Chat ${conv.conversation_id.substring(0, 8)}`}
                      </h3>
                      <span className="text-[10px] text-zinc-500 font-medium whitespace-nowrap ml-1 flex-shrink-0">
                        {formatDateShorthand(conv.updated_at)}
                      </span>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <p className={`text-xs truncate pr-3 ${
                        conv.is_unread ? 'text-zinc-200 font-semibold' : 'text-zinc-500'
                      }`}>
                        {conv.last_message ? conv.last_message : `ID: ${conv.conversation_id}`}
                      </p>
                      
                      {/* Status Indicators */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {conv.is_pinned && (
                          <Pin size={10} className="text-zinc-400 fill-zinc-400 rotate-45" />
                        )}
                        {conv.is_unread && (
                          <span className="w-2.5 h-2.5 bg-sky-500 rounded-full shadow-md shadow-sky-500/20" />
                        )}
                      </div>
                    </div>
                  </div>

                </div>

                {/* Right Hover Actions (Context Menu overlay items) */}
                <div className="hidden group-hover:flex items-center gap-1.5 bg-black/90 pl-3 pr-2 py-1 absolute right-3 rounded-lg shadow-lg border border-zinc-800">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onTogglePin(conv);
                    }}
                    className="p-1 hover:bg-zinc-805 text-zinc-450 hover:text-zinc-200 rounded transition-all"
                    title={conv.is_pinned ? "Unpin chat" : "Pin chat"}
                  >
                    <Pin size={12} className={conv.is_pinned ? "fill-zinc-300 text-zinc-300" : "rotate-45"} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleUnread(conv);
                    }}
                    className="p-1 hover:bg-zinc-805 text-zinc-450 hover:text-zinc-200 rounded transition-all"
                    title={conv.is_unread ? "Mark as read" : "Mark as unread"}
                  >
                    {conv.is_unread ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                </div>

              </div>
            );
          })
        )}
      </div>

    </div>
  );
}
