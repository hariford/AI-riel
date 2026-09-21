/**
 * @airiel/protocol — shared, runtime-validated types for renderer ⇄ main ⇄ gateway.
 * Everything crossing a process or network boundary is defined here.
 */
import { z } from 'zod';

// ───────────────────────── Chat messages ─────────────────────────

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** JSON-encoded arguments exactly as the model produced them. */
  arguments: z.string(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ChatMessageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('system'), content: z.string() }),
  z.object({ role: z.literal('user'), content: z.string() }),
  z.object({
    role: z.literal('assistant'),
    content: z.string().nullable(),
    toolCalls: z.array(ToolCallSchema).optional(),
  }),
  z.object({ role: z.literal('tool'), toolCallId: z.string(), content: z.string() }),
]);
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// ───────────────────────── Tools ─────────────────────────

/** JSON Schema subset accepted by Foundry / OpenAI function calling. */
export const ToolDefinitionSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  description: z.string(),
  parameters: z.record(z.unknown()),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export const ToolResultSchema = z.object({
  toolCallId: z.string(),
  ok: z.boolean(),
  /** Text returned to the model (already truncated to budget). */
  content: z.string(),
  /** Optional structured payload for the UI (diff, exit code, …). */
  ui: z.unknown().optional(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

// ───────────────────────── Permissions ─────────────────────────

export const PermissionModeSchema = z.enum(['ask', 'auto-edit', 'plan']);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

export const PermissionDecisionSchema = z.enum(['allow', 'allow-session', 'deny']);
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;

export const PermissionRequestSchema = z.object({
  requestId: z.string(),
  toolCall: ToolCallSchema,
  /** Human-readable summary, e.g. "Edit src/foo.ts" or "Run: dotnet test". */
  title: z.string(),
  /** Optional preview: unified diff, command line, etc. */
  preview: z.string().optional(),
  kind: z.enum(['read', 'edit', 'command', 'other']),
});
export type PermissionRequest = z.infer<typeof PermissionRequestSchema>;

// ───────────────────────── Gateway API ─────────────────────────

export const ChatRequestSchema = z.object({
  conversationId: z.string(),
  messages: z.array(ChatMessageSchema),
  tools: z.array(ToolDefinitionSchema).optional(),
  /** Logical model name resolved by the gateway to a Foundry deployment. */
  model: z.enum(['default', 'small']).default('default'),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/** Server-sent events emitted by POST /v1/chat. */
export const ChatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), delta: z.string() }),
  z.object({
    type: z.literal('tool_call'),
    index: z.number().int(),
    id: z.string().optional(),
    name: z.string().optional(),
    argumentsDelta: z.string().optional(),
  }),
  z.object({
    type: z.literal('done'),
    finishReason: z.enum(['stop', 'tool_calls', 'length', 'content_filter']),
    usage: z
      .object({
        promptTokens: z.number(),
        completionTokens: z.number(),
        cachedTokens: z.number().optional(),
      })
      .optional(),
  }),
  z.object({ type: z.literal('error'), message: z.string(), code: z.string().optional() }),
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;

export const SpeechTokenResponseSchema = z.object({
  token: z.string(),
  region: z.string(),
  /** Custom-domain host (AI Services / Foundry resource). When present the client connects via host, not region. */
  host: z.string().optional(),
  expiresAt: z.string().datetime(),
});
export type SpeechTokenResponse = z.infer<typeof SpeechTokenResponseSchema>;

export const UsageRecordSchema = z.object({
  userId: z.string(),
  userName: z.string(),
  conversationId: z.string(),
  model: z.string(),
  promptTokens: z.number().int(),
  completionTokens: z.number().int(),
  cachedTokens: z.number().int().default(0),
  toolCalls: z.number().int().default(0),
  latencyMs: z.number().int(),
  createdAt: z.string().datetime(),
});
export type UsageRecord = z.infer<typeof UsageRecordSchema>;

// ───────────────────────── Desktop IPC ─────────────────────────

/** Events streamed from main → renderer while a turn runs. */
export const AgentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), delta: z.string() }),
  z.object({ type: z.literal('tool_start'), toolCall: ToolCallSchema }),
  z.object({ type: z.literal('tool_result'), result: ToolResultSchema }),
  z.object({ type: z.literal('permission_request'), request: PermissionRequestSchema }),
  z.object({ type: z.literal('turn_done') }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;

export const ConversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  workspaceRoot: z.string(),
  updatedAt: z.string().datetime(),
});
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

export const UserProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

/** IPC channel names — single source of truth for preload + main + renderer. */
export const IPC = {
  authSignIn: 'auth:sign-in',
  authSignOut: 'auth:sign-out',
  authGetUser: 'auth:get-user',
  workspacePick: 'workspace:pick',
  workspaceGet: 'workspace:get',
  conversationList: 'conversation:list',
  conversationLoad: 'conversation:load',
  conversationNew: 'conversation:new',
  agentSend: 'agent:send',
  agentCancel: 'agent:cancel',
  agentUndo: 'agent:undo',
  agentEvent: 'agent:event',
  permissionRespond: 'permission:respond',
  permissionSetMode: 'permission:set-mode',
  speechToken: 'speech:token',
} as const;
