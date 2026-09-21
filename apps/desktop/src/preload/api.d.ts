import type {
  AgentEvent,
  ChatMessage,
  ConversationSummary,
  PermissionDecision,
  PermissionMode,
  SpeechTokenResponse,
  UserProfile,
} from '@airiel/protocol';

export interface Conversation extends ConversationSummary {
  messages: ChatMessage[];
}

/** The only surface the renderer can reach; everything privileged stays in main. */
export interface AirielApi {
  auth: {
    getUser(): Promise<UserProfile | null>;
    signIn(): Promise<UserProfile>;
    signOut(): Promise<void>;
  };
  workspace: {
    pick(): Promise<string | null>;
    get(): Promise<string | null>;
  };
  conversations: {
    list(): Promise<ConversationSummary[]>;
    load(id: string): Promise<Conversation | null>;
    create(): Promise<string>;
  };
  agent: {
    send(conversationId: string, text: string): Promise<void>;
    cancel(conversationId: string): Promise<void>;
    undoLastTurn(): Promise<string[]>;
    respondToPermission(requestId: string, decision: PermissionDecision): Promise<void>;
    setPermissionMode(mode: PermissionMode): Promise<void>;
    onEvent(handler: (payload: { conversationId: string; ev: AgentEvent }) => void): () => void;
  };
  speech: {
    token(): Promise<SpeechTokenResponse>;
  };
}

declare global {
  interface Window {
    airiel: AirielApi;
  }
}
