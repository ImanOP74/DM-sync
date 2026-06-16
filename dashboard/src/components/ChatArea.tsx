import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Conversation, Message } from '@/types/database';
import { 
  ArrowLeft, Sparkles, MessageSquare, Lock, Send, Search, Info, 
  Star, Image as ImageIcon, Video, Download, BarChart2, Calendar, 
  User, Check, X, Keyboard, FileText, ChevronRight
} from 'lucide-react';

interface ChatAreaProps {
  selectedConversation: Conversation;
  messages: Message[];
  isLoadingMessages: boolean;
  isMobileView: boolean;
  onBack: () => void;
  onToggleBookmark: (msg: Message) => void;
  onLoadMore: () => Promise<void>;
  hasMore: boolean;
  isLoadingMore: boolean;
}

export default function ChatArea({
  selectedConversation,
  messages,
  isLoadingMessages,
  isMobileView,
  onBack,
  onToggleBookmark,
  onLoadMore,
  hasMore,
  isLoadingMore
}: ChatAreaProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  // UI states
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState('');
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'bookmarks' | 'media'>('info');

  // Track scroll details for infinite pagination (preserves scroll offset)
  const prevScrollHeightRef = useRef<number>(0);
  const prevScrollTopRef = useRef<number>(0);
  const isFetchingMoreRef = useRef<boolean>(false);

  // Auto-scroll on initial select
  useEffect(() => {
    if (scrollContainerRef.current && !isLoadingMessages && !isFetchingMoreRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [selectedConversation, isLoadingMessages]);

  // Local Keyboard Shortcuts Event Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(prev => !prev);
        if (searchOpen) setMessageSearchQuery('');
      }
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setShowInfoPanel(prev => !prev);
      }
      if (e.key === 'Escape') {
        if (showShortcutsHelp) {
          setShowShortcutsHelp(false);
        } else if (searchOpen) {
          setSearchOpen(false);
          setMessageSearchQuery('');
        } else if (showInfoPanel) {
          setShowInfoPanel(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchOpen, showInfoPanel, showShortcutsHelp]);

  // Adjust scroll position after pagination items are loaded
  useEffect(() => {
    if (scrollContainerRef.current && isFetchingMoreRef.current) {
      const container = scrollContainerRef.current;
      const heightDifference = container.scrollHeight - prevScrollHeightRef.current;
      container.scrollTop = prevScrollTopRef.current + heightDifference;
      isFetchingMoreRef.current = false;
    } else if (scrollContainerRef.current && messages.length > 0) {
      // Smooth scroll for new message arrivals
      const container = scrollContainerRef.current;
      const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
      if (isAtBottom) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      }
    }
  }, [messages]);

  // Infinite Scroll scroll handler
  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container || isLoadingMore || !hasMore) return;

    // Trigger load more when user hits the top of the chat area
    if (container.scrollTop <= 10 && !isFetchingMoreRef.current) {
      isFetchingMoreRef.current = true;
      prevScrollHeightRef.current = container.scrollHeight;
      prevScrollTopRef.current = container.scrollTop;
      onLoadMore().catch(() => {
        isFetchingMoreRef.current = false;
      });
    }
  };

  const getInitials = (name: string | null) => {
    if (!name) return 'IG';
    return name.substring(0, 2).toUpperCase();
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

  // Check if dates are different or separated by large time gap
  const shouldShowDateSeparator = (msg: Message, prevMsg: Message | null) => {
    if (!prevMsg) return true;
    const date1 = new Date(msg.timestamp);
    const date2 = new Date(prevMsg.timestamp);
    return date1.toDateString() !== date2.toDateString() || 
           Math.abs(date1.getTime() - date2.getTime()) > 6 * 60 * 60 * 1000;
  };

  const formatDateSeparator = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const today = new Date();
      const yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);
      
      const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      
      if (date.toDateString() === today.toDateString()) {
        return `Today ${timeStr}`;
      }
      if (date.toDateString() === yesterday.toDateString()) {
        return `Yesterday ${timeStr}`;
      }
      
      return `${date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })} • ${timeStr}`;
    } catch {
      return '';
    }
  };

  // Helper to determine message cluster rounding
  const getBubbleRounding = (isMe: boolean, isFirst: boolean, isLast: boolean) => {
    if (isMe) {
      if (isFirst && isLast) return 'rounded-2xl rounded-br-none';
      if (isFirst) return 'rounded-2xl rounded-br-md';
      if (isLast) return 'rounded-2xl rounded-tr-md rounded-br-none';
      return 'rounded-2xl rounded-tr-md rounded-br-md';
    } else {
      if (isFirst && isLast) return 'rounded-2xl rounded-bl-none';
      if (isFirst) return 'rounded-2xl rounded-bl-md';
      if (isLast) return 'rounded-2xl rounded-tl-md rounded-bl-none';
      return 'rounded-2xl rounded-tl-md rounded-bl-md';
    }
  };

  // Escape special regex characters
  const escapeRegExp = (str: string) => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  // Highlight matching search text
  const renderHighlightedContent = (content: string | null) => {
    if (!content) return '';
    
    // Check if it's a URL first
    if (content.startsWith('http://') || content.startsWith('https://')) {
      const isImg = /\.(jpeg|jpg|gif|png|webp)/i.test(content) || content.includes('images.unsplash.com') || content.includes('supabase.co/storage');
      const isVid = /\.(mp4|webm)/i.test(content);
      
      if (isImg) {
        return (
          <img 
            src={content} 
            alt="Shared Attachment" 
            className="max-w-xs max-h-60 rounded-xl object-cover cursor-pointer border border-zinc-800 hover:opacity-90 transition-opacity"
            onClick={() => window.open(content, '_blank')}
            referrerPolicy="no-referrer"
          />
        );
      }
      
      if (isVid) {
        return (
          <video 
            src={content} 
            controls 
            className="max-w-xs max-h-60 rounded-xl border border-zinc-800" 
          />
        );
      }

      // Link Preview Card
      let domain = content;
      try {
        domain = new URL(content).hostname;
      } catch {}

      return (
        <a 
          href={content} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="flex flex-col gap-1.5 p-3 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-850 transition-colors w-64 text-left"
        >
          <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Link Shared</span>
          <span className="text-sm font-semibold text-zinc-200 truncate">{domain}</span>
          <span className="text-xs text-sky-400 truncate underline">{content}</span>
        </a>
      );
    }

    if (!messageSearchQuery.trim()) return content;

    const parts = content.split(new RegExp(`(${escapeRegExp(messageSearchQuery)})`, 'gi'));
    return (
      <>
        {parts.map((part, i) => 
          part.toLowerCase() === messageSearchQuery.toLowerCase() 
            ? <mark key={i} className="bg-pink-500/40 text-white rounded px-0.5">{part}</mark> 
            : part
        )}
      </>
    );
  };

  // Group messages dynamically by sender and 2-minute time window
  const messageGroups = useMemo(() => {
    const groups: {
      isMe: boolean;
      senderName: string;
      senderUsername: string;
      messages: Message[];
    }[] = [];

    messages.forEach((msg, idx) => {
      const prevMsg = idx > 0 ? messages[idx - 1] : null;
      const isMe = msg.sent_by_me;
      
      const timeDiff = prevMsg 
        ? Math.abs(new Date(msg.timestamp).getTime() - new Date(prevMsg.timestamp).getTime())
        : Infinity;

      const isSameCluster = prevMsg && 
        prevMsg.sent_by_me === msg.sent_by_me && 
        prevMsg.sender_name === msg.sender_name &&
        timeDiff < 2 * 60 * 1000 && // 2 minutes threshold
        !shouldShowDateSeparator(msg, prevMsg);

      if (isSameCluster && groups.length > 0) {
        groups[groups.length - 1].messages.push(msg);
      } else {
        groups.push({
          isMe,
          senderName: msg.sender_name || (isMe ? 'me' : 'other'),
          senderUsername: msg.sender_username || '',
          messages: [msg]
        });
      }
    });

    return groups;
  }, [messages]);

  // Statistics calculations
  const stats = useMemo(() => {
    const total = messages.length;
    const sentByMe = messages.filter(m => m.sent_by_me).length;
    const sentByOthers = total - sentByMe;
    const bookmarkedCount = messages.filter(m => m.is_bookmarked).length;

    // Media list
    const media = messages.filter(m => {
      const c = m.content || '';
      return c.startsWith('http') && (/\.(jpeg|jpg|gif|png|webp|mp4|webm)/i.test(c) || c.includes('unsplash') || c.includes('supabase'));
    });

    // Busy hours calculation
    const hourCounts = new Array(24).fill(0);
    messages.forEach(m => {
      try {
        const hour = new Date(m.timestamp).getHours();
        hourCounts[hour]++;
      } catch {}
    });
    
    let peakHour = 0;
    let maxCount = 0;
    hourCounts.forEach((cnt, hr) => {
      if (cnt > maxCount) {
        maxCount = cnt;
        peakHour = hr;
      }
    });

    const formatHour = (h: number) => {
      const ampm = h >= 12 ? 'PM' : 'AM';
      const display = h % 12 || 12;
      return `${display} ${ampm}`;
    };

    return {
      total,
      sentByMe,
      sentByOthers,
      bookmarkedCount,
      mediaCount: media.length,
      media,
      peakHour: maxCount > 0 ? formatHour(peakHour) : 'N/A'
    };
  }, [messages]);

  // Export handlers
  const handleExportJSON = () => {
    const blob = new Blob([JSON.stringify(messages, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dm-mirror-${selectedConversation.conversation_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportTXT = () => {
    const text = messages.map(m => {
      const date = new Date(m.timestamp).toLocaleString();
      const sender = m.sent_by_me ? 'Me' : (m.sender_username || m.sender_name || 'Other');
      return `[${date}] ${sender}: ${m.content}`;
    }).join('\n');

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dm-mirror-${selectedConversation.conversation_id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 flex bg-black h-full relative overflow-hidden">
      
      {/* 1. Main Chat Area Viewport */}
      <div className="flex-1 flex flex-col h-full bg-[#000000] border-r border-zinc-900 relative">
        
        {/* Header Bar */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-900 bg-black/90 backdrop-blur-md sticky top-0 z-15">
          <div className="flex items-center gap-3.5 min-w-0">
            {isMobileView && (
              <button 
                onClick={onBack}
                className="p-1 hover:bg-zinc-900 rounded-lg text-zinc-400 hover:text-zinc-100 transition-colors"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            
            {/* Participant Profile Picture */}
            {selectedConversation.avatar_url ? (
              <img 
                src={selectedConversation.avatar_url} 
                alt={selectedConversation.conversation_name || 'Avatar'} 
                className="w-10 h-10 rounded-full object-cover shadow border border-zinc-800"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className={`flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-tr ${getAvatarGradient(selectedConversation.conversation_id)} text-white font-semibold text-xs shadow`}>
                {getInitials(selectedConversation.conversation_name)}
              </div>
            )}
            
            <div className="min-w-0">
              <h2 className="font-bold text-sm text-zinc-100 truncate">
                {selectedConversation.conversation_name || 'DM Mirror Thread'}
              </h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-[10px] text-zinc-500 font-semibold tracking-wider uppercase truncate max-w-[150px]">
                  ID: {selectedConversation.conversation_id}
                </span>
              </div>
            </div>
          </div>

          {/* Action Icons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setSearchOpen(!searchOpen);
                if (searchOpen) setMessageSearchQuery('');
              }}
              className={`p-2 hover:bg-zinc-900 rounded-lg text-zinc-400 hover:text-zinc-100 transition-colors ${
                searchOpen ? 'bg-zinc-900 text-zinc-100' : ''
              }`}
              title="Search in messages"
            >
              <Search size={16} />
            </button>
            <button
              onClick={() => setShowInfoPanel(!showInfoPanel)}
              className={`p-2 hover:bg-zinc-900 rounded-lg text-zinc-400 hover:text-zinc-100 transition-colors ${
                showInfoPanel ? 'bg-zinc-900 text-zinc-100' : ''
              }`}
              title="Conversation details"
            >
              <Info size={16} />
            </button>
          </div>
        </div>

        {/* Message Search Sub-bar */}
        {searchOpen && (
          <div className="px-5 py-2.5 bg-zinc-950 border-b border-zinc-900 flex items-center gap-3">
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="Search messages keyword..."
                value={messageSearchQuery}
                onChange={(e) => setMessageSearchQuery(e.target.value)}
                autoFocus
                className="w-full pl-9 pr-8 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs placeholder-zinc-500 focus:outline-none focus:border-zinc-700 transition-all text-zinc-100"
              />
              <Search className="absolute left-3 top-2 text-zinc-500" size={13} />
              {messageSearchQuery && (
                <button 
                  onClick={() => setMessageSearchQuery('')}
                  className="absolute right-3 top-2 text-zinc-500 hover:text-zinc-300"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <button 
              onClick={() => {
                setSearchOpen(false);
                setMessageSearchQuery('');
              }}
              className="text-xs text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Message Scroller Pane */}
        <div 
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-5 space-y-4 bg-zinc-950 scroll-smooth relative"
        >
          {/* Pagination loading indicator */}
          {isLoadingMore && (
            <div className="flex justify-center items-center py-2">
              <div className="w-4 h-4 border-2 border-zinc-800 border-t-zinc-400 rounded-full animate-spin" />
            </div>
          )}

          {isLoadingMessages ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <div className="w-5 h-5 border-2 border-zinc-800 border-t-zinc-400 rounded-full animate-spin" />
              <span className="text-xs font-semibold text-zinc-500">Loading synced messages...</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <MessageSquare className="text-zinc-800 mb-3 animate-pulse" size={42} />
              <p className="text-sm font-semibold text-zinc-400">No synced messages</p>
              <p className="text-xs text-zinc-650 max-w-xs mt-1.5 leading-relaxed">
                Start scrolling inside this thread on Instagram Web to sync backlog messages automatically.
              </p>
            </div>
          ) : (
            messageGroups.map((group, groupIdx) => {
              const prevGroup = groupIdx > 0 ? messageGroups[groupIdx - 1] : null;
              
              // Calculate date separator
              const firstMsgInGroup = group.messages[0];
              const prevLastMsg = prevGroup ? prevGroup.messages[prevGroup.messages.length - 1] : null;
              const showDateSep = shouldShowDateSeparator(firstMsgInGroup, prevLastMsg);

              return (
                <div key={groupIdx} className="space-y-1.5">
                  
                  {/* Date Separation Ribbon */}
                  {showDateSep && (
                    <div className="flex justify-center my-6">
                      <span className="px-3 py-1 rounded-full text-[10px] font-bold text-zinc-550 bg-zinc-900/40 uppercase tracking-widest border border-zinc-900/50">
                        {formatDateSeparator(firstMsgInGroup.timestamp)}
                      </span>
                    </div>
                  )}

                  {/* Header Title (Group chats sender name display) */}
                  {!group.isMe && (
                    <span className="text-[10px] text-zinc-550 font-bold ml-14 mb-1 tracking-wider uppercase block">
                      {group.senderName === group.senderUsername 
                        ? group.senderName 
                        : `${group.senderName} (@${group.senderUsername})`}
                    </span>
                  )}

                  {/* Message rows under this cluster */}
                  {group.messages.map((msg, msgIdx) => {
                    const isFirst = msgIdx === 0;
                    const isLast = msgIdx === group.messages.length - 1;
                    const isImg = msg.content?.startsWith('http') && /\.(jpeg|jpg|gif|png|webp)/i.test(msg.content);
                    const isVid = msg.content?.startsWith('http') && /\.(mp4|webm)/i.test(msg.content);

                    return (
                      <div 
                        key={msg.id} 
                        className={`flex items-end gap-3.5 group relative ${
                          group.isMe ? 'justify-end' : 'justify-start'
                        }`}
                        onDoubleClick={() => onToggleBookmark(msg)}
                      >
                        
                        {/* Avatar Column (Left side of incoming bubbles) */}
                        {!group.isMe && (
                          <div className="w-10 flex-shrink-0 flex justify-center">
                            {isLast ? (
                              selectedConversation.avatar_url && selectedConversation.conversation_name === group.senderName ? (
                                <img 
                                  src={selectedConversation.avatar_url} 
                                  alt="Sender" 
                                  className="w-7 h-7 rounded-full object-cover border border-zinc-900 shadow-sm"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className={`flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-tr ${getAvatarGradient(group.senderUsername)} text-white font-bold text-[9px] shadow-sm`}>
                                  {getInitials(group.senderName)}
                                </div>
                              )
                            ) : null}
                          </div>
                        )}

                        {/* Interactive message row details */}
                        <div className={`flex items-center gap-2 max-w-[75%] md:max-w-[65%] ${
                          group.isMe ? 'flex-row-reverse' : 'flex-row'
                        }`}>
                          
                          {/* Message Bubble Container */}
                          <div 
                            className={`px-4 py-2 text-sm shadow break-words leading-relaxed transition-all ${
                              group.isMe 
                                ? 'bg-zinc-100 text-black shadow-zinc-950/20' 
                                : 'bg-zinc-900 text-zinc-200 border border-zinc-800/40'
                            } ${getBubbleRounding(group.isMe, isFirst, isLast)} ${
                              (isImg || isVid) ? 'p-0 bg-transparent border-none shadow-none' : ''
                            }`}
                            title={new Date(msg.timestamp).toLocaleString()}
                          >
                            {renderHighlightedContent(msg.content)}
                          </div>

                          {/* Hover action togglers (bookmark) */}
                          <div className="hidden group-hover:flex items-center gap-1.5 px-1 flex-shrink-0">
                            <button
                              onClick={() => onToggleBookmark(msg)}
                              className={`p-1.5 rounded-lg hover:bg-zinc-900 transition-colors text-zinc-550 ${
                                msg.is_bookmarked ? 'text-amber-500 hover:text-amber-400' : 'hover:text-zinc-200'
                              }`}
                              title={msg.is_bookmarked ? "Bookmarked" : "Bookmark message"}
                            >
                              <Star size={12} className={msg.is_bookmarked ? 'fill-amber-500' : ''} />
                            </button>
                          </div>

                        </div>

                        {/* Persistent Bookmark Indicator Star (Outside Hover) */}
                        {msg.is_bookmarked && !msg.sent_by_me && (
                          <Star size={10} className="text-amber-500 fill-amber-500 absolute -right-0.5 bottom-2.5" />
                        )}
                        {msg.is_bookmarked && msg.sent_by_me && (
                          <Star size={10} className="text-amber-500 fill-amber-500 absolute -left-0.5 bottom-2.5" />
                        )}

                      </div>
                    );
                  })}

                </div>
              );
            })
          )}
        </div>

        {/* Read-Only Banner / Warning */}
        <div className="p-4 bg-black border-t border-zinc-900 flex items-center gap-3">
          <div className="flex-1 flex items-center gap-3 bg-zinc-950 border border-zinc-900 rounded-xl px-4 py-3 select-none text-zinc-550 text-xs italic">
            <Lock size={12} className="text-zinc-700 flex-shrink-0" />
            <span className="truncate">Mirrored archive folder. Click "Sync History" on Instagram to fetch more backlog messages.</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-zinc-950 border border-zinc-900 flex items-center justify-center text-zinc-750 select-none">
            <Send size={15} />
          </div>
        </div>

      </div>

      {/* 2. Right Collapsible Statistics / Info Panel Drawer */}
      {showInfoPanel && (
        <div className="w-80 flex-shrink-0 flex flex-col h-full bg-[#000000] border-l border-zinc-900 z-10 animate-in slide-in-from-right duration-250">
          
          {/* Header */}
          <div className="p-4 border-b border-zinc-900 flex justify-between items-center bg-black/90">
            <span className="text-xs font-bold text-zinc-300 tracking-wider uppercase">Conversation Info</span>
            <button 
              onClick={() => setShowInfoPanel(false)}
              className="p-1 hover:bg-zinc-900 rounded-lg text-zinc-400 hover:text-zinc-100"
            >
              <X size={15} />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-zinc-900 bg-zinc-950 text-xs">
            <button
              onClick={() => setActiveTab('info')}
              className={`flex-1 py-3 text-center border-b font-semibold transition-all ${
                activeTab === 'info' 
                  ? 'border-white text-zinc-100' 
                  : 'border-transparent text-zinc-500 hover:text-zinc-350'
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab('bookmarks')}
              className={`flex-1 py-3 text-center border-b font-semibold transition-all ${
                activeTab === 'bookmarks' 
                  ? 'border-white text-zinc-100' 
                  : 'border-transparent text-zinc-500 hover:text-zinc-350'
              }`}
            >
              Bookmarks ({stats.bookmarkedCount})
            </button>
            <button
              onClick={() => setActiveTab('media')}
              className={`flex-1 py-3 text-center border-b font-semibold transition-all ${
                activeTab === 'media' 
                  ? 'border-white text-zinc-100' 
                  : 'border-transparent text-zinc-500 hover:text-zinc-350'
              }`}
            >
              Media ({stats.mediaCount})
            </button>
          </div>

          {/* Tab Content area */}
          <div className="flex-1 overflow-y-auto p-4 scrollbar-none">
            
            {/* Overview / Stats Tab */}
            {activeTab === 'info' && (
              <div className="space-y-6">
                
                {/* Meta details */}
                <div className="flex flex-col items-center text-center gap-3 py-3 border-b border-zinc-900/60">
                  {selectedConversation.avatar_url ? (
                    <img 
                      src={selectedConversation.avatar_url} 
                      alt="Avatar" 
                      className="w-16 h-16 rounded-full object-cover border border-zinc-800 shadow-md"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className={`flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-tr ${getAvatarGradient(selectedConversation.conversation_id)} text-white font-bold text-lg shadow-md`}>
                      {getInitials(selectedConversation.conversation_name)}
                    </div>
                  )}
                  <div>
                    <h3 className="font-bold text-zinc-200 text-md leading-snug">
                      {selectedConversation.conversation_name || 'Instagram User'}
                    </h3>
                    <p className="text-[10px] text-zinc-550 mt-1 font-semibold tracking-wide uppercase break-all">
                      Thread ID: {selectedConversation.conversation_id}
                    </p>
                  </div>
                </div>

                {/* Stats Panel */}
                <div className="space-y-3">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Activity Metrics</h4>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-3 bg-zinc-950 border border-zinc-900 rounded-xl flex flex-col gap-0.5">
                      <span className="text-[9px] font-bold text-zinc-550 uppercase">Total Messages</span>
                      <span className="text-lg font-bold text-zinc-200">{stats.total}</span>
                    </div>
                    <div className="p-3 bg-zinc-950 border border-zinc-900 rounded-xl flex flex-col gap-0.5">
                      <span className="text-[9px] font-bold text-zinc-550 uppercase">Peak Active Hour</span>
                      <span className="text-sm font-bold text-zinc-200 truncate mt-1">{stats.peakHour}</span>
                    </div>
                  </div>

                  <div className="p-3 bg-zinc-950 border border-zinc-900 rounded-xl space-y-2.5">
                    <span className="text-[9px] font-bold text-zinc-550 uppercase block">Message distribution</span>
                    
                    <div className="flex items-center justify-between text-xs font-semibold text-zinc-350">
                      <span>Me: {stats.sentByMe}</span>
                      <span>Them: {stats.sentByOthers}</span>
                    </div>
                    
                    {/* Progress Visual Bar */}
                    <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden flex">
                      <div 
                        className="bg-zinc-200 h-full transition-all duration-300"
                        style={{ width: `${stats.total > 0 ? (stats.sentByMe / stats.total) * 100 : 50}%` }}
                      />
                      <div className="bg-zinc-800 h-full flex-1" />
                    </div>
                  </div>
                </div>

                {/* Keyboard Shortcuts Trigger Button */}
                <div className="p-3 bg-zinc-950 border border-zinc-900 rounded-xl flex items-center justify-between hover:bg-zinc-900/40 cursor-pointer transition-colors" onClick={() => setShowShortcutsHelp(true)}>
                  <div className="flex items-center gap-2.5">
                    <Keyboard size={14} className="text-zinc-400" />
                    <span className="text-xs font-semibold text-zinc-300">Keyboard Shortcuts</span>
                  </div>
                  <ChevronRight size={14} className="text-zinc-650" />
                </div>

                {/* Export Card Actions */}
                <div className="space-y-3">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Backup & Export</h4>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={handleExportJSON}
                      className="w-full py-2 bg-zinc-950 hover:bg-zinc-900 border border-zinc-850 text-zinc-300 hover:text-zinc-150 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors select-none"
                    >
                      <Download size={13} />
                      Export Chat as JSON
                    </button>
                    <button
                      onClick={handleExportTXT}
                      className="w-full py-2 bg-zinc-950 hover:bg-zinc-900 border border-zinc-850 text-zinc-300 hover:text-zinc-150 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors select-none"
                    >
                      <FileText size={13} />
                      Export Chat as TXT
                    </button>
                  </div>
                </div>

              </div>
            )}

            {/* Bookmarked Messages tab */}
            {activeTab === 'bookmarks' && (
              <div className="space-y-3">
                {messages.filter(m => m.is_bookmarked).length === 0 ? (
                  <div className="text-center py-12">
                    <Star size={24} className="mx-auto text-zinc-800 mb-2.5" />
                    <p className="text-xs font-semibold text-zinc-400">No bookmarked messages</p>
                    <p className="text-[10px] text-zinc-650 max-w-[180px] mx-auto mt-1 leading-relaxed">
                      Double-click any message inside the chat thread to pin it to bookmarks.
                    </p>
                  </div>
                ) : (
                  messages.filter(m => m.is_bookmarked).map(msg => (
                    <div 
                      key={msg.id}
                      className="p-3 bg-zinc-950 border border-zinc-900 rounded-xl hover:border-zinc-800 transition-all text-left flex flex-col gap-1.5 relative group"
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-[9px] font-bold text-zinc-500 uppercase">
                          {msg.sent_by_me ? 'Me' : (msg.sender_username || msg.sender_name || 'Other')}
                        </span>
                        <span className="text-[9px] text-zinc-650 font-medium">
                          {new Date(msg.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-350 leading-relaxed max-h-16 overflow-hidden text-ellipsis line-clamp-3">
                        {msg.content}
                      </p>
                      <button 
                        onClick={() => onToggleBookmark(msg)}
                        className="absolute right-2 top-2 p-1 text-zinc-600 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove bookmark"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Media Gallery Grid tab */}
            {activeTab === 'media' && (
              <div>
                {stats.mediaCount === 0 ? (
                  <div className="text-center py-12">
                    <ImageIcon size={24} className="mx-auto text-zinc-800 mb-2.5" />
                    <p className="text-xs font-semibold text-zinc-400">No shared media</p>
                    <p className="text-[10px] text-zinc-655 max-w-[180px] mx-auto mt-1 leading-relaxed">
                      Images and videos shared within this conversation will render in this panel.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-1.5">
                    {stats.media.map(msg => {
                      const isVid = msg.content?.includes('.mp4') || msg.content?.includes('.webm');
                      return (
                        <div 
                          key={msg.id} 
                          className="aspect-square bg-zinc-950 border border-zinc-900 rounded-lg overflow-hidden relative group cursor-pointer hover:border-zinc-750 transition-colors"
                          onClick={() => window.open(msg.content || '', '_blank')}
                        >
                          {isVid ? (
                            <div className="w-full h-full flex items-center justify-center bg-zinc-900">
                              <Video size={16} className="text-zinc-550" />
                            </div>
                          ) : (
                            <img 
                              src={msg.content || ''} 
                              alt="Media" 
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-250"
                              referrerPolicy="no-referrer"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

          </div>

        </div>
      )}

      {/* Keyboard Shortcuts Modal Dialog */}
      {showShortcutsHelp && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setShowShortcutsHelp(false)}>
          <div className="bg-zinc-950 border border-zinc-850 rounded-2xl w-full max-w-sm p-6 shadow-2xl relative" onClick={e => e.stopPropagation()}>
            <button 
              onClick={() => setShowShortcutsHelp(false)}
              className="absolute right-4 top-4 p-1 hover:bg-zinc-900 rounded-lg text-zinc-450 hover:text-zinc-200"
            >
              <X size={14} />
            </button>
            <div className="flex items-center gap-2.5 mb-4">
              <Keyboard size={16} className="text-zinc-350" />
              <h3 className="text-sm font-bold text-zinc-200">Keyboard Shortcuts Guide</h3>
            </div>
            
            <div className="space-y-3.5 text-xs text-zinc-400">
              <div className="flex justify-between items-center py-1 border-b border-zinc-900/60">
                <span>Next Conversation</span>
                <kbd className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded font-semibold text-[10px] text-zinc-300">Alt + ↓</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-zinc-900/60">
                <span>Previous Conversation</span>
                <kbd className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded font-semibold text-[10px] text-zinc-300">Alt + ↑</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-zinc-900/60">
                <span>Search in Message History</span>
                <kbd className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded font-semibold text-[10px] text-zinc-300">Ctrl + Alt + F</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-zinc-900/60">
                <span>Toggle Right Info Drawer</span>
                <kbd className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded font-semibold text-[10px] text-zinc-300">Ctrl + Alt + I</kbd>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-zinc-900/60">
                <span>Deselect active chat / Close dialog</span>
                <kbd className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded font-semibold text-[10px] text-zinc-300">Esc</kbd>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
