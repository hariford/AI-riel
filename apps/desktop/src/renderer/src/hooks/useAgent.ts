import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { AgentEvent, PermissionDecision, PermissionRequest, ToolCall, ToolResult } from '@airiel/protocol';

/** UI-side transcript items: richer than ChatMessage so tool calls render as cards. */
export type TranscriptItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'tool'; id: string; call: ToolCall; result?: ToolResult }
  | { kind: 'error'; id: string; text: string };

export interface AgentState {
  items: TranscriptItem[];
  running: boolean;
  pending: PermissionRequest | null;
}

type Action =
  | { type: 'reset'; items: TranscriptItem[] }
  | { type: 'user'; text: string }
  | { type: 'event'; ev: AgentEvent }
  | { type: 'resolved' };

let counter = 0;
const nid = () => `i${++counter}`;

function reduce(state: AgentState, a: Action): AgentState {
  switch (a.type) {
    case 'reset':
      return { items: a.items, running: false, pending: null };
    case 'user':
      return { ...state, running: true, items: [...state.items, { kind: 'user', id: nid(), text: a.text }] };
    case 'resolved':
      return { ...state, pending: null };
    case 'event': {
      const ev = a.ev;
      const items = state.items.slice();
      const last = items[items.length - 1];
      switch (ev.type) {
        case 'text':
          if (last?.kind === 'assistant' && last.streaming) {
            items[items.length - 1] = { ...last, text: last.text + ev.delta };
          } else {
            items.push({ kind: 'assistant', id: nid(), text: ev.delta, streaming: true });
          }
          return { ...state, items };
        case 'tool_start':
          if (last?.kind === 'assistant') items[items.length - 1] = { ...last, streaming: false };
          items.push({ kind: 'tool', id: nid(), call: ev.toolCall });
          return { ...state, items };
        case 'tool_result': {
          const idx = items.findIndex((i) => i.kind === 'tool' && i.call.id === ev.result.toolCallId);
          if (idx >= 0) items[idx] = { ...(items[idx] as Extract<TranscriptItem, { kind: 'tool' }>), result: ev.result };
          return { ...state, items };
        }
        case 'permission_request':
          return { ...state, pending: ev.request };
        case 'error':
          items.push({ kind: 'error', id: nid(), text: ev.message });
          return { ...state, items };
        case 'turn_done':
          if (last?.kind === 'assistant') items[items.length - 1] = { ...last, streaming: false };
          return { ...state, items, running: false, pending: null };
      }
    }
  }
  return state;
}

export function useAgent(conversationId: string | null) {
  const [state, dispatch] = useReducer(reduce, { items: [], running: false, pending: null });
  const convRef = useRef(conversationId);
  convRef.current = conversationId;

  useEffect(() => {
    return window.airiel.agent.onEvent(({ conversationId: cid, ev }) => {
      if (cid === convRef.current) dispatch({ type: 'event', ev });
    });
  }, []);

  const reset = useCallback((items: TranscriptItem[]) => dispatch({ type: 'reset', items }), []);

  const send = useCallback(
    async (text: string) => {
      if (!convRef.current) return;
      dispatch({ type: 'user', text });
      await window.airiel.agent.send(convRef.current, text);
    },
    [],
  );

  const cancel = useCallback(async () => {
    if (convRef.current) await window.airiel.agent.cancel(convRef.current);
  }, []);

  const respond = useCallback(async (requestId: string, decision: PermissionDecision) => {
    dispatch({ type: 'resolved' });
    await window.airiel.agent.respondToPermission(requestId, decision);
  }, []);

  return { state, send, cancel, respond, reset };
}
