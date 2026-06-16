export interface Conversation {
  id: string;
  conversation_id: string;          // Instagram native thread ID (relation key)
  conversation_name: string | null; // Display name of the chat
  avatar_url: string | null;        // Participant's avatar photo URL
  last_message: string | null;      // Cached latest message preview
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;       // References conversations.conversation_id directly (string)
  message_hash: string;          // Deduplication hash signature
  sender_name: string | null;     // Sender name
  sender_username: string | null; // Sender Instagram username
  content: string | null;        // Message body content
  timestamp: string;             // Native Instagram message timestamp
  sent_by_me: boolean;           // Outgoing message flag
  created_at: string;            // Database insertion timestamp
}
