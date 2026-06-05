export type SessionStatus = 'starting' | 'ready' | 'exited';
export type TerminalSessionMode = 'desktop' | 'bridge';
export type TerminalResizeMode = 'fit' | 'fixed';
export type TerminalWriteSource = 'local' | 'bridge' | 'system' | 'automation';
export type TerminalControlKey = 'ctrl-c' | 'esc' | 'enter' | 'up' | 'down' | 'left' | 'right';
export type TerminalSnapshotReason = 'before-send' | 'after-complete' | 'manual';
export const TERMINAL_SLOT_IDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export type TerminalSlotId = (typeof TERMINAL_SLOT_IDS)[number];
export type BridgeReplyFormat = 'command' | 'plain-text';
export type AppLogStream = 'stdout' | 'stderr';
export type CompletionReason =
  | 'prompt_ready'
  | 'idle_stable'
  | 'soft_timeout_stable'
  | 'no_output_timeout'
  | 'hard_timeout_failed'
  | 'aborted';

export interface TerminalDimensions {
  cols: number;
  rows: number;
}

export interface BridgeTimingSettings {
  inflightScreenshotDelayMs: number;
  redrawWaitAfterShrinkMs: number;
  beforeSendRedrawRestoreMs: number;
  afterCompleteRedrawRestoreMs: number;
  beforeSendPostRedrawDelayMs: number;
  preTextInputSnapshotDelayMs: number;
  textSubmitEnterDelayMs: number;
  repeatedControlKeyDelayMs: number;
  completionSettleMs: number;
  completionNoOutputTimeoutMs: number;
  completionPollIntervalMs: number;
  completionStablePollCount: number;
  manualRedrawWaitAfterShrinkMs: number;
  manualRedrawWaitAfterRestoreMs: number;
  liveViewSnapshotDebounceMs: number;
  snapshotMirrorFlushTimeoutMs: number;
  windowScreenshotCaptureDelayMs: number;
  terminalScreenshotResizeSettleMs: number;
  terminalScreenshotPollIntervalMs: number;
  terminalScreenshotReadyTimeoutMs: number;
  appRestartDelayMs: number;
  attachmentDownloadTimeoutMs: number;
}

export interface BridgeArtifactPublishSettings {
  watchDirectory: string;
  channelId: string;
}

export interface BridgeSettings {
  autoScreenshotOnReply: boolean;
  inflightScreenshotOnRunningRequest: boolean;
  replyFormat: BridgeReplyFormat;
  softTimeoutMs: number;
  hardTimeoutMs: number | null;
  diffAnchorChars: number;
  bridgeDimensions: TerminalDimensions;
  timing: BridgeTimingSettings;
  artifactPublish: BridgeArtifactPublishSettings;
}

export interface BridgeSettingsUpdate {
  autoScreenshotOnReply?: boolean;
  inflightScreenshotOnRunningRequest?: boolean;
  replyFormat?: BridgeReplyFormat;
  softTimeoutMs?: number;
  hardTimeoutMs?: number | null;
  diffAnchorChars?: number;
  bridgeDimensions?: Partial<TerminalDimensions>;
  timing?: Partial<BridgeTimingSettings>;
  artifactPublish?: Partial<BridgeArtifactPublishSettings>;
}

export interface TerminalSlotSettings {
  slotId: TerminalSlotId;
  workspaceName: string;
  channelId: string;
  cwd: string;
  startupCommandEnabled: boolean;
  startupCommandText: string;
}

export interface TerminalSlotSettingsUpdate {
  slotId: TerminalSlotId;
  workspaceName?: string;
  channelId?: string;
  cwd?: string;
  startupCommandEnabled?: boolean;
  startupCommandText?: string;
}

export interface TerminalSlotSettingsUpdateResult {
  slot: TerminalSlotSettings;
  session?: TerminalSessionSummary;
}

export interface WorkspacePaneLayout {
  columnFractions: [number, number, number, number];
  rowFractions: [number, number];
}

export interface AppLogEntry {
  id: number;
  timestamp: string;
  stream: AppLogStream;
  text: string;
}

export interface BootstrapState {
  defaultCwd: string;
  shellLabel: string;
  bridgeDimensions: TerminalDimensions;
  bridgeSettings: BridgeSettings;
  workspacePaneLayout: WorkspacePaneLayout;
  terminalSlots: TerminalSlotSettings[];
  sessions: TerminalSessionSummary[];
  appLogs: AppLogEntry[];
}

export interface CreateSessionOptions {
  cwd?: string;
  mode?: TerminalSessionMode;
  dimensions?: Partial<TerminalDimensions>;
  title?: string;
  slotId?: TerminalSlotId;
}

export interface TerminalSessionSummary extends TerminalDimensions {
  id: string;
  slotId?: TerminalSlotId;
  shellLabel: string;
  status: SessionStatus;
  mode: TerminalSessionMode;
  resizeMode: TerminalResizeMode;
  inputLocked: boolean;
  title?: string;
  cwd?: string;
  exitCode?: number;
}

export interface TerminalSessionDataEvent {
  sessionId: string;
  data: string;
}

export interface TerminalSessionExitEvent {
  sessionId: string;
  exitCode: number;
}

export type TerminalSessionActivationSource = 'discord' | 'automation';

export interface TerminalSessionActivatedEvent {
  sessionId: string;
  source: TerminalSessionActivationSource;
}

export interface TerminalSessionRenameRequest {
  sessionId: string;
  title: string;
}

export interface TerminalWriteRequest {
  sessionId: string;
  data: string;
  source?: TerminalWriteSource;
}

export interface TerminalResizeRequest extends TerminalDimensions {
  sessionId: string;
  source?: TerminalWriteSource;
  force?: boolean;
}

export interface TerminalInputLockUpdate {
  sessionId: string;
  locked: boolean;
}

export interface TerminalControlRequest {
  sessionId: string;
  key: TerminalControlKey;
  repeatCount?: number;
  repeatDelayMs?: number;
  source?: TerminalWriteSource;
}

export interface TerminalRedrawJiggleRequest {
  sessionId: string;
  shrinkCols?: number;
  waitAfterShrinkMs?: number;
  waitAfterRestoreMs?: number;
}

export interface TerminalSnapshotRequest {
  sessionId: string;
  reason?: TerminalSnapshotReason;
}

export interface TerminalSessionSnapshot extends TerminalDimensions {
  snapshotId: string;
  sessionId: string;
  capturedAt: string;
  reason: TerminalSnapshotReason;
  source: 'headless-mirror';
  serializationFormat: 'xterm-screen-v1';
  screenText: string;
  screenRevision: number;
  lineCount: number;
  hash: string;
  rawTranscriptLength: number;
}

export interface TerminalScreenshotExportData extends TerminalDimensions {
  sessionId: string;
  title?: string;
  cwd?: string;
  transcript: string;
}

export interface TerminalSessionState extends TerminalDimensions {
  sessionId: string;
  status: SessionStatus;
  mode: TerminalSessionMode;
  resizeMode: TerminalResizeMode;
  inputLocked: boolean;
  activeBufferType: 'normal' | 'alternate';
  screenRevision: number;
  observedOutputEvents: number;
  rawTranscriptLength: number;
  lastSnapshotHash?: string;
  lastActivityAt?: string;
  lastPromptReadyAt?: string;
}

export type TerminalSlotForegroundStatus = 'starting' | 'powershell-ready' | 'command-active' | 'exited';

export type TerminalSlotInboundKind = 'discord' | 'slot' | 'human' | 'cron' | 'external' | 'local';

export interface TerminalSlotInboundEntry {
  timestamp: string;
  from: string;
  kind: TerminalSlotInboundKind;
  text: string;
}

export interface TerminalSlotState {
  slotId: TerminalSlotId;
  sessionId?: string;
  cwd?: string;
  status: TerminalSlotForegroundStatus;
  updatedAt: string;
  foregroundCommand?: string;
  recentInbound: TerminalSlotInboundEntry[];
}

export interface TerminalSlotStateSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  slots: TerminalSlotState[];
}

export interface TerminalSendInputRequest {
  sessionId: string;
  content: string;
  appendEnter?: boolean;
  source?: TerminalWriteSource;
}

export interface TerminalWaitForCompletionRequest {
  sessionId: string;
  expectOutput?: boolean;
  promoteToOutputOnMeaningfulChange?: boolean;
  beforeScreenText?: string;
  submittedText?: string;
  baselinePromptReadyAt?: string;
  baselineRawOutputOffset?: number;
  baselineObservedOutputEvents?: number;
  settleMs?: number;
  softTimeoutMs?: number;
  noOutputTimeoutMs?: number;
  hardTimeoutMs?: number | null;
  pollIntervalMs?: number;
  stablePollCount?: number;
}

export interface TerminalWaitForCompletionResult {
  sessionId: string;
  success: boolean;
  reason: CompletionReason;
  completedAt: string;
  screenRevision: number;
  snapshotHash: string;
  observedOutputEvents: number;
  rawTranscriptLength: number;
  lastActivityAt?: string;
  lastPromptReadyAt?: string;
}

export interface TerminalDiffResult {
  beforeSnapshotId?: string;
  afterSnapshotId: string;
  diffText: string;
  diffLineCount: number;
  wasFallbackUsed: boolean;
  source: 'raw-output' | 'screen-diff' | 'after-tail';
}

export interface TerminalAutomationTurnRequest {
  sessionId: string;
  kind: 'text' | 'control';
  content?: string;
  appendEnter?: boolean;
  key?: TerminalControlKey;
  repeatCount?: number;
  repeatDelayMs?: number;
  expectOutput?: boolean;
  captureBefore?: boolean;
  captureAfter?: boolean;
}

export interface TerminalAutomationTurnResult {
  beforeSnapshot?: TerminalSessionSnapshot;
  afterSnapshot?: TerminalSessionSnapshot;
  rawOutput: string;
  diff: TerminalDiffResult;
  replyChunks: string[];
  completion: TerminalWaitForCompletionResult;
}

export interface TerminalViewSnapshotPublishRequest {
  activeSessionId?: string | null;
}

export interface TerminalViewSnapshotSession {
  id: string;
  title?: string;
  shellLabel: string;
  status: SessionStatus;
  mode: TerminalSessionMode;
  resizeMode: TerminalResizeMode;
  inputLocked: boolean;
  cwd?: string;
  exitCode?: number;
  isActive: boolean;
}

export interface TerminalViewSnapshotTerminal {
  sessionId: string;
  status: SessionStatus;
  mode: TerminalSessionMode;
  resizeMode: TerminalResizeMode;
  inputLocked: boolean;
  screenText: string;
  screenRevision: number;
  lineCount: number;
  hash: string;
  rawTranscriptLength: number;
  observedOutputEvents: number;
  lastActivityAt?: string;
  lastPromptReadyAt?: string;
}

export interface TerminalViewSnapshot {
  timestamp: string;
  activeSessionId: string | null;
  sessions: TerminalViewSnapshotSession[];
  terminal: TerminalViewSnapshotTerminal | null;
  sessionTerminals: TerminalViewSnapshotTerminal[];
}

export interface TerminalApi {
  bootstrap(): Promise<BootstrapState>;
  restartTerminalSlot(slotId: TerminalSlotId): Promise<TerminalSessionSummary>;
  updateTerminalSlot(update: TerminalSlotSettingsUpdate): Promise<TerminalSlotSettingsUpdateResult>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  write(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  renameSession(request: TerminalSessionRenameRequest): Promise<TerminalSessionSummary>;
  getSessionState(sessionId: string): Promise<TerminalSessionState>;
  getBufferSnapshot(request: TerminalSnapshotRequest): Promise<TerminalSessionSnapshot>;
  sendInput(request: TerminalSendInputRequest): Promise<void>;
  waitForCompletion(request: TerminalWaitForCompletionRequest): Promise<TerminalWaitForCompletionResult>;
  runAutomationTurn(request: TerminalAutomationTurnRequest): Promise<TerminalAutomationTurnResult>;
  redrawJiggle(request: TerminalRedrawJiggleRequest): Promise<void>;
  sendKey(request: TerminalControlRequest): Promise<void>;
  stopRequest(sessionId: string): Promise<void>;
  setInputLock(update: TerminalInputLockUpdate): Promise<TerminalSessionSummary>;
  onSessionUpdated(listener: (session: TerminalSessionSummary) => void): () => void;
  onSessionData(listener: (event: TerminalSessionDataEvent) => void): () => void;
  onSessionExit(listener: (event: TerminalSessionExitEvent) => void): () => void;
  onSessionActivated(listener: (event: TerminalSessionActivatedEvent) => void): () => void;
  onAppLogEntry(listener: (entry: AppLogEntry) => void): () => void;
  updateBridgeSettings(update: BridgeSettingsUpdate): Promise<BridgeSettings>;
  updateWorkspacePaneLayout(layout: WorkspacePaneLayout): Promise<WorkspacePaneLayout>;
  publishLiveViewSnapshot(request: TerminalViewSnapshotPublishRequest): Promise<void>;
  getTerminalScreenshotExport(sessionId: string): Promise<TerminalScreenshotExportData>;
}
