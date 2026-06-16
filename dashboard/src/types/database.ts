export interface Conversation {
  id: string;
  conversation_id: string; // Instagram Native thread ID
  username: string | null;   // Participant display name / username
  avatar_url: string | null; // Profile picture URL
  last_message: string | null; // Denormalized preview text
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string; // Foreign key referencing conversations.id UUID
  message_hash: string;    // Unique deduplication hash signature
  sender_name: string | null; // Sender name
  content: string | null;  // Message text content
  timestamp: string;       // Native Instagram message timestamp
  sent_by_me: boolean;     // Sent by user check
  created_at: string;      // Database insertion timestamp
}
