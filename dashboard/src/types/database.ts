export interface Conversation {
  id: string;
  instagram_thread_id: string;
  name: string | null;
  is_group: boolean;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  instagram_message_id: string;
  sender_id: string;
  sender_username: string | null;
  text: string | null;
  media_url: string | null;
  media_type: string | null;
  metadata: Record<string, any>;
  created_at: string;
  synced_at: string;
}
