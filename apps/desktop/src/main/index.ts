import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { IPC, PermissionDecisionSchema, PermissionModeSchema, type AgentEvent } from '@airiel/protocol';
import { AgentHost, createProvider } from './agent-host.js';
import { AuthService } from './auth.js';
import { loadDesktopConfig } from './config.js';
import { JsonConversationStore } from './conversation-store.js';

const cfg = loadDesktopConfig();
const auth = new AuthService(cfg);
const store = new JsonConversationStore(path.join(app.getPath('userData'), 'conversations'));

let win: BrowserWindow | null = null;

const host = new AgentHost({
  provider: createProvider(cfg.gatewayUrl, () => auth.getAccessToken()),
  store,
  emit: (conversationId: string, ev: AgentEvent) => win?.webContents.send(IPC.agentEvent, { conversationId, ev }),
});

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "AI'riel",
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs contextBridge only; sandbox can be enabled once verified
    },
  });

  // Open external links in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
  win.on('closed', () => (win = null));
}

function registerIpc(): void {
  ipcMain.handle(IPC.authGetUser, () => auth.currentUser());
  ipcMain.handle(IPC.authSignIn, () => auth.signIn());
  ipcMain.handle(IPC.authSignOut, () => auth.signOut());

  ipcMain.handle(IPC.workspacePick, async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], title: 'Open a working directory' });
    if (r.canceled || !r.filePaths[0]) return null;
    host.setWorkspace(r.filePaths[0]);
    return r.filePaths[0];
  });
  ipcMain.handle(IPC.workspaceGet, () => host.workspaceRoot);

  ipcMain.handle(IPC.conversationList, () => store.list());
  ipcMain.handle(IPC.conversationLoad, (_e, id: string) => store.load(id));
  ipcMain.handle(IPC.conversationNew, () => crypto.randomUUID());

  ipcMain.handle(IPC.agentSend, (_e, conversationId: string, text: string) => {
    void host.send(String(conversationId), String(text)).catch((err: Error) => {
      win?.webContents.send(IPC.agentEvent, { conversationId, ev: { type: 'error', message: err.message } });
      win?.webContents.send(IPC.agentEvent, { conversationId, ev: { type: 'turn_done' } });
    });
  });
  ipcMain.handle(IPC.agentCancel, (_e, conversationId: string) => host.cancel(String(conversationId)));
  ipcMain.handle(IPC.permissionRespond, (_e, requestId: string, decision: unknown) =>
    host.respondToPermission(String(requestId), PermissionDecisionSchema.parse(decision)),
  );
  ipcMain.handle(IPC.permissionSetMode, (_e, mode: unknown) => host.setPermissionMode(PermissionModeSchema.parse(mode)));
  ipcMain.handle(IPC.agentUndo, () => host.undoLastTurn());

  ipcMain.handle(IPC.speechToken, async () => {
    const token = await auth.getAccessToken();
    const res = await fetch(`${cfg.gatewayUrl}/v1/speech/token`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Speech token failed: ${res.status}`);
    return res.json();
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
