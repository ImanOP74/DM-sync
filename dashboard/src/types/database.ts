export interface Conversation {
  id: string;
  instagram_thread_id: string;
  name: string | null;
  is_group: boolean;
  metadata: Record<string, any>;
  
  // Cached Last Message preview columns (denormalized)
  last_message_preview: string | null;
  last_message_time: string | null;
  last_message_sender_id: string | null;

  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  instagram_message_id: string;
  sender_id: string; // 'me' or 'other'
  sender_username: string | null; // actual profile display name
  text: string | null;
  media_url: string | null;
  media_type: string | null;
  metadata: Record<string, any>;
  created_at: string;
  synced_at: string;
}
