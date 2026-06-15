import React from 'react';
import { Sparkles, Smartphone, Lock } from 'lucide-react';

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

export default function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-zinc-900/30 via-zinc-950 to-zinc-950">
      <div className="max-w-md text-center flex flex-col items-center gap-6">
        
        {/* Branding Circle */}
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-pink-500 via-red-500 to-yellow-500 flex items-center justify-center shadow-xl">
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
  );
}
