import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@airiel/protocol';
import type { AirielApi } from './api.js';

const api: AirielApi = {
  auth: {
    getUser: () => ipcRenderer.invoke(IPC.authGetUser),
    signIn: () => ipcRenderer.invoke(IPC.authSignIn),
    signOut: () => ipcRenderer.invoke(IPC.authSignOut),
  },
  workspace: {
    pick: () => ipcRenderer.invoke(IPC.workspacePick),
    get: () => ipcRenderer.invoke(IPC.workspaceGet),
  },
  conversations: {
    list: () => ipcRenderer.invoke(IPC.conversationList),
    load: (id) => ipcRenderer.invoke(IPC.conversationLoad, id),
    create: () => ipcRenderer.invoke(IPC.conversationNew),
  },
  agent: {
    send: (conversationId, text) => ipcRenderer.invoke(IPC.agentSend, conversationId, text),
    cancel: (conversationId) => ipcRenderer.invoke(IPC.agentCancel, conversationId),
    undoLastTurn: () => ipcRenderer.invoke(IPC.agentUndo),
    respondToPermission: (requestId, decision) => ipcRenderer.invoke(IPC.permissionRespond, requestId, decision),
    setPermissionMode: (mode) => ipcRenderer.invoke(IPC.permissionSetMode, mode),
    onEvent: (handler) => {
      const listener = (_e: unknown, payload: Parameters<typeof handler>[0]) => handler(payload);
      ipcRenderer.on(IPC.agentEvent, listener);
      return () => ipcRenderer.removeListener(IPC.agentEvent, listener);
    },
  },
  speech: {
    token: () => ipcRenderer.invoke(IPC.speechToken),
  },
};

contextBridge.exposeInMainWorld('airiel', api);
