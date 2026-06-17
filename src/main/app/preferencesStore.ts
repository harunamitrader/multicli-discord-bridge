import type { BridgeReplyFormat, BridgeSettings, BridgeSettingsUpdate, TerminalSlotId, TerminalSlotSettings, WorkspacePaneLayout } from '../../shared/terminal';
import { TERMINAL_SLOT_IDS } from '../../shared/terminal';
import { app, Rectangle } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface StoredWindowBounds extends Pick<Rectangle, 'x' | 'y' | 'width' | 'height'> {}

interface StoredBridgeTimingSettings {
  inflightScreenshotDelaySeconds?: number;
  inflightScreenshotDelayMs?: number;
  redrawWaitAfterShrinkMs?: number;
  beforeSendRedrawRestoreMs?: number;
  afterCompleteRedrawRestoreMs?: number;
  beforeSendPostRedrawDelayMs?: number;
  preTextInputSnapshotDelayMs?: number;
  textSubmitEnterDelayMs?: number;
  repeatedControlKeyDelayMs?: number;
  completionSettleMs?: number;
  completionNoOutputTimeoutMs?: number;
  completionPollIntervalMs?: number;
  completionStablePollCount?: number;
  manualRedrawWaitAfterShrinkMs?: number;
  manualRedrawWaitAfterRestoreMs?: number;
  liveViewSnapshotDebounceMs?: number;
  snapshotMirrorFlushTimeoutMs?: number;
  windowScreenshotCaptureDelayMs?: number;
  terminalScreenshotResizeSettleMs?: number;
  terminalScreenshotPollIntervalMs?: number;
  terminalScreenshotReadyTimeoutMs?: number;
  appRestartDelayMs?: number;
  attachmentDownloadTimeoutMs?: number;
}

interface StoredPreferences {
  lastCwd?: string;
  windowBounds?: StoredWindowBounds;
  workspacePaneLayout?: {
    columnFractions?: number[];
    rowFractions?: number[];
  };
  terminalSlots?: StoredTerminalSlot[];
  bridgeSettings?: {
    replyTextOnCompletion?: boolean;
    completionReplyMaxChars?: number;
    autoScreenshotOnReply?: boolean;
    inflightScreenshotOnRunningRequest?: boolean;
    replyFormat?: BridgeReplyFormat;
    softTimeoutMs?: number;
    hardTimeoutMs?: number | null;
    diffAnchorChars?: number;
    bridgeDimensions?: {
      cols?: number;
      rows?: number;
    };
    artifactPublish?: {
      watchDirectory?: string;
      channelId?: string;
    };
    timing?: StoredBridgeTimingSettings;
  };
}

interface StoredTerminalSlot {
  slotId: TerminalSlotId;
  workspaceName?: string;
  channelId?: string;
  cwd?: string;
  startupCommandEnabled?: boolean;
  startupCommandText?: string;
}

const DEFAULT_BRIDGE_SETTINGS = {
  replyTextOnCompletion: true,
  completionReplyMaxChars: 5000,
  autoScreenshotOnReply: true,
  inflightScreenshotOnRunningRequest: true,
  replyFormat: 'command' as BridgeReplyFormat,
  softTimeoutMs: 300000,
  hardTimeoutMs: null,
  diffAnchorChars: 300,
  bridgeDimensions: {
    cols: 100,
    rows: 50
  },
  artifactPublish: {
    watchDirectory: '',
    channelId: ''
  },
  timing: {
    inflightScreenshotDelayMs: 10000,
    redrawWaitAfterShrinkMs: 500,
    beforeSendRedrawRestoreMs: 1500,
    afterCompleteRedrawRestoreMs: 1000,
    beforeSendPostRedrawDelayMs: 500,
    preTextInputSnapshotDelayMs: 500,
    textSubmitEnterDelayMs: 500,
    repeatedControlKeyDelayMs: 100,
    completionSettleMs: 2000,
    completionNoOutputTimeoutMs: 3000,
    completionPollIntervalMs: 500,
    completionStablePollCount: 3,
    manualRedrawWaitAfterShrinkMs: 150,
    manualRedrawWaitAfterRestoreMs: 250,
    liveViewSnapshotDebounceMs: 120,
    snapshotMirrorFlushTimeoutMs: 2000,
    windowScreenshotCaptureDelayMs: 100,
    terminalScreenshotResizeSettleMs: 120,
    terminalScreenshotPollIntervalMs: 50,
    terminalScreenshotReadyTimeoutMs: 10000,
    appRestartDelayMs: 500,
    attachmentDownloadTimeoutMs: 30000
  }
} as const;
export const MIN_BRIDGE_COLS = 40;
export const MIN_BRIDGE_ROWS = 15;
export const MAX_BRIDGE_COLS = 400;
export const MAX_BRIDGE_ROWS = 120;
export const MIN_TIMING_DELAY_MS = 0;
export const MAX_TIMING_DELAY_MS = 120000;
export const MIN_TIMING_COUNT = 1;
export const MAX_TIMING_COUNT = 20;
const MIN_SOFT_TIMEOUT_MS = 1000;
const MAX_SOFT_TIMEOUT_MS = 300000;
const MIN_HARD_TIMEOUT_MS = 5000;
const MAX_HARD_TIMEOUT_MS = 7200000;
export const MIN_DIFF_ANCHOR_CHARS = 50;
export const MAX_DIFF_ANCHOR_CHARS = 5000;
export const MIN_COMPLETION_REPLY_MAX_CHARS = 100;
export const MAX_COMPLETION_REPLY_MAX_CHARS = 20000;
const SLOT_IDS = TERMINAL_SLOT_IDS;
const DEFAULT_WORKSPACE_PANE_LAYOUT: WorkspacePaneLayout = {
  columnFractions: [0.25, 0.25, 0.25, 0.25],
  rowFractions: [0.5, 0.5]
};

export class PreferencesStore {
  private readonly filePath: string;
  private state: StoredPreferences;

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'preferences.json');
    this.state = this.load();
    this.removeLegacyDefaultWorkspaceCwd();
    this.ensureTerminalSlotsPersisted();
    this.ensureWorkspacePaneLayoutPersisted();
  }

  getLastCwd(): string | undefined {
    return this.state.lastCwd;
  }

  getDefaultWorkspaceCwd(): string {
    return this.state.lastCwd || app.getPath('home');
  }

  setLastCwd(cwd: string): void {
    this.state.lastCwd = cwd;
    this.save();
  }

  getTerminalSlots(): TerminalSlotSettings[] {
    const defaultCwd = this.getDefaultWorkspaceCwd();
    const storedById = new Map((this.state.terminalSlots ?? []).map((slot) => [slot.slotId, slot]));
    return SLOT_IDS.map((slotId) => {
      const stored = storedById.get(slotId);
      return {
        slotId,
        workspaceName: normalizeWorkspaceName(stored?.workspaceName, slotId),
        channelId: stored?.channelId?.trim() ?? '',
        cwd: stored?.cwd?.trim() || defaultCwd,
        startupCommandEnabled: stored?.startupCommandEnabled ?? false,
        startupCommandText: normalizeStartupCommandText(stored?.startupCommandText)
      };
    });
  }

  updateTerminalSlot(
    slotId: TerminalSlotId,
    update: {
      workspaceName?: string;
      channelId?: string;
      cwd?: string;
      startupCommandEnabled?: boolean;
      startupCommandText?: string;
    }
  ): TerminalSlotSettings {
    const slots = this.getTerminalSlots();
    const index = slots.findIndex((slot) => slot.slotId === slotId);
    if (index === -1) {
      throw new Error(`Unknown terminal slot: ${slotId}`);
    }

    const current = slots[index];
    const startupCommandText =
      update.startupCommandText === undefined ? current.startupCommandText : normalizeStartupCommandText(update.startupCommandText);
    const startupCommandEnabled =
      update.startupCommandEnabled === undefined ? current.startupCommandEnabled : Boolean(update.startupCommandEnabled);
    validateStartupCommandSettings(startupCommandEnabled, startupCommandText);
    const next = {
      slotId,
      workspaceName:
        update.workspaceName === undefined ? current.workspaceName : normalizeWorkspaceName(update.workspaceName, slotId),
      channelId: update.channelId === undefined ? current.channelId : update.channelId.trim(),
      cwd: update.cwd === undefined ? current.cwd : update.cwd.trim() || this.getDefaultWorkspaceCwd(),
      startupCommandEnabled,
      startupCommandText
    };

    slots[index] = next;
    this.state.terminalSlots = slots;
    this.save();
    return next;
  }

  getWindowBounds(): StoredWindowBounds | undefined {
    return this.state.windowBounds;
  }

  setWindowBounds(bounds: Rectangle): void {
    this.state.windowBounds = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    };
    this.save();
  }

  getWorkspacePaneLayout(): WorkspacePaneLayout {
    return normalizeWorkspacePaneLayout(this.state.workspacePaneLayout);
  }

  setWorkspacePaneLayout(layout: WorkspacePaneLayout): WorkspacePaneLayout {
    this.state.workspacePaneLayout = normalizeWorkspacePaneLayout(layout);
    this.save();
    return this.getWorkspacePaneLayout();
  }

  getBridgeSettings(): BridgeSettings {
    return {
      replyTextOnCompletion:
        this.state.bridgeSettings?.replyTextOnCompletion ?? DEFAULT_BRIDGE_SETTINGS.replyTextOnCompletion,
      completionReplyMaxChars: clampInteger(
        this.state.bridgeSettings?.completionReplyMaxChars,
        MIN_COMPLETION_REPLY_MAX_CHARS,
        MAX_COMPLETION_REPLY_MAX_CHARS,
        DEFAULT_BRIDGE_SETTINGS.completionReplyMaxChars
      ),
      autoScreenshotOnReply: this.state.bridgeSettings?.autoScreenshotOnReply ?? DEFAULT_BRIDGE_SETTINGS.autoScreenshotOnReply,
      inflightScreenshotOnRunningRequest:
        this.state.bridgeSettings?.inflightScreenshotOnRunningRequest ?? DEFAULT_BRIDGE_SETTINGS.inflightScreenshotOnRunningRequest,
      replyFormat: normalizeBridgeReplyFormat(this.state.bridgeSettings?.replyFormat),
      softTimeoutMs: clampInteger(
        this.state.bridgeSettings?.softTimeoutMs,
        MIN_SOFT_TIMEOUT_MS,
        MAX_SOFT_TIMEOUT_MS,
        DEFAULT_BRIDGE_SETTINGS.softTimeoutMs
      ),
      hardTimeoutMs: clampNullableInteger(
        this.state.bridgeSettings?.hardTimeoutMs,
        MIN_HARD_TIMEOUT_MS,
        MAX_HARD_TIMEOUT_MS,
        DEFAULT_BRIDGE_SETTINGS.hardTimeoutMs
      ),
      diffAnchorChars: clampInteger(
        this.state.bridgeSettings?.diffAnchorChars,
        MIN_DIFF_ANCHOR_CHARS,
        MAX_DIFF_ANCHOR_CHARS,
        DEFAULT_BRIDGE_SETTINGS.diffAnchorChars
      ),
      bridgeDimensions: {
        cols: clampInteger(
          this.state.bridgeSettings?.bridgeDimensions?.cols,
          MIN_BRIDGE_COLS,
          MAX_BRIDGE_COLS,
          DEFAULT_BRIDGE_SETTINGS.bridgeDimensions.cols
        ),
        rows: clampInteger(
          this.state.bridgeSettings?.bridgeDimensions?.rows,
          MIN_BRIDGE_ROWS,
          MAX_BRIDGE_ROWS,
          DEFAULT_BRIDGE_SETTINGS.bridgeDimensions.rows
        )
      },
      artifactPublish: {
        watchDirectory: normalizeArtifactPublishPath(this.state.bridgeSettings?.artifactPublish?.watchDirectory),
        channelId: normalizeDiscordChannelId(this.state.bridgeSettings?.artifactPublish?.channelId)
      },
      timing: {
        inflightScreenshotDelayMs: clampInteger(
          resolveInflightScreenshotDelayMs(this.state.bridgeSettings?.timing),
          MIN_TIMING_DELAY_MS,
          MAX_TIMING_DELAY_MS,
          DEFAULT_BRIDGE_SETTINGS.timing.inflightScreenshotDelayMs
        ),
        redrawWaitAfterShrinkMs: clampInteger(
          this.state.bridgeSettings?.timing?.redrawWaitAfterShrinkMs,
          MIN_TIMING_DELAY_MS,
          MAX_TIMING_DELAY_MS,
          DEFAULT_BRIDGE_SETTINGS.timing.redrawWaitAfterShrinkMs
        ),
        beforeSendRedrawRestoreMs: clampInteger(
          this.state.bridgeSettings?.timing?.beforeSendRedrawRestoreMs,
          MIN_TIMING_DELAY_MS,
          MAX_TIMING_DELAY_MS,
          DEFAULT_BRIDGE_SETTINGS.timing.beforeSendRedrawRestoreMs
        ),
        afterCompleteRedrawRestoreMs: clampInteger(
          this.state.bridgeSettings?.timing?.afterCompleteRedrawRestoreMs,
          MIN_TIMING_DELAY_MS,
          MAX_TIMING_DELAY_MS,
          DEFAULT_BRIDGE_SETTINGS.timing.afterCompleteRedrawRestoreMs
        ),
        beforeSendPostRedrawDelayMs: clampInteger(
          this.state.bridgeSettings?.timing?.beforeSendPostRedrawDelayMs,
          MIN_TIMING_DELAY_MS,
          MAX_TIMING_DELAY_MS,
          DEFAULT_BRIDGE_SETTINGS.timing.beforeSendPostRedrawDelayMs
        ),
        preTextInputSnapshotDelayMs: clampInteger(
          this.state.bridgeSettings?.timing?.preTextInputSnapshotDelayMs,
          MIN_TIMING_DELAY_MS,
          MAX_TIMING_DELAY_MS,
          DEFAULT_BRIDGE_SETTINGS.timing.preTextInputSnapshotDelayMs
        ),
        textSubmitEnterDelayMs: clampInteger(
          this.state.bridgeSettings?.timing?.textSubmitEnterDelayMs,
          MIN_TIMING_DELAY_MS,
          MAX_TIMING_DELAY_MS,
          DEFAULT_BRIDGE_SETTINGS.timing.textSubmitEnterDelayMs
        ),
        repeatedControlKeyDelayMs: clampInteger(
          this.state.bridgeSettings?.timing?.repeatedControlKeyDelayMs,
          MIN_TIMING_DELAY_MS,
          MAX_TIMING_DELAY_MS,
          DEFAULT_BRIDGE_SETTINGS.timing.repeatedControlKeyDelayMs
        ),
        completionSettleMs: clampInteger(
          this.state.bridgeSettings?.timing?.completionSettleMs,
          MIN_TIMING_DELAY_MS,
          MAX_TIMING_DELAY_MS,
          DEFAULT_BRIDGE_SETTINGS.timing.completionSettleMs
        ),
        completionNoOutputTimeoutMs: clampInteger(
          this.state.bridgeSettings?.timing?.completionNoOutputTimeoutMs,
          MIN_TIMING_DELAY_MS,
          MAX_TIMING_DELAY_MS,
          DEFAULT_BRIDGE_SETTINGS.timing.completionNoOutputTimeoutMs
        ),
        completionPollIntervalMs: clampInteger(
          this.state.bridgeSettings?.timing?.completionPollIntervalMs,
          MIN_TIMING_DELAY_MS,
          MAX_TIMING_DELAY_MS,
          DEFAULT_BRIDGE_SETTINGS.timing.completionPollIntervalMs
        ),
        completionStablePollCount: clampInteger(
          this.state.bridgeSettings?.timing?.completionStablePollCount,
          MIN_TIMING_COUNT,
          MAX_TIMING_COUNT,
          DEFAULT_BRIDGE_SETTINGS.timing.completionStablePollCount
        ),
        manualRedrawWaitAfterShrinkMs: clampInteger(
          this.state.bridgeSettings?.timing?.manualRedrawWaitAfterShrinkMs,
          MIN_TIMING_DELAY_MS,
          MAX_TIMING_DELAY_MS,
          DEFAULT_BRIDGE_SETTINGS.timing.manualRedrawWaitAfterShrinkMs
        ),
        manualRedrawWaitAfterRestoreMs: clampInteger(
          this.state.bridgeSettings?.timing?.manualRedrawWaitAfterRestoreMs,
          MIN_TIMING_DELAY_MS,
          MAX_TIMING_DELAY_MS,
          DEFAULT_BRIDGE_SETTINGS.timing.manualRedrawWaitAfterRestoreMs
        ),
        liveViewSnapshotDebounceMs: clampInteger(
          this.state.bridgeSettings?.timing?.liveViewSnapshotDebounceMs,
          MIN_TIMING_DELAY_MS,
          MAX_TIMING_DELAY_MS,
          DEFAULT_BRIDGE_SETTINGS.timing.liveViewSnapshotDebounceMs
        ),
        snapshotMirrorFlushTimeoutMs: clampInteger(
          this.state.bridgeSettings?.timing?.snapshotMirrorFlushTimeoutMs,
          MIN_TIMING_DELAY_MS,
          MAX_TIMING_DELAY_MS,
          DEFAULT_BRIDGE_SETTINGS.timing.snapshotMirrorFlushTimeoutMs
        ),
        windowScreenshotCaptureDelayMs: clampInteger(
          this.state.bridgeSettings?.timing?.windowScreenshotCaptureDelayMs,
          MIN_TIMING_DELAY_MS,
          MAX_TIMING_DELAY_MS,
          DEFAULT_BRIDGE_SETTINGS.timing.windowScreenshotCaptureDelayMs
        ),
        terminalScreenshotResizeSettleMs: clampInteger(
          this.state.bridgeSettings?.timing?.terminalScreenshotResizeSettleMs,
          MIN_TIMING_DELAY_MS,
          MAX_TIMING_DELAY_MS,
          DEFAULT_BRIDGE_SETTINGS.timing.terminalScreenshotResizeSettleMs
        ),
        terminalScreenshotPollIntervalMs: clampInteger(
          this.state.bridgeSettings?.timing?.terminalScreenshotPollIntervalMs,
          MIN_TIMING_DELAY_MS,
          MAX_TIMING_DELAY_MS,
          DEFAULT_BRIDGE_SETTINGS.timing.terminalScreenshotPollIntervalMs
        ),
        terminalScreenshotReadyTimeoutMs: clampInteger(
          this.state.bridgeSettings?.timing?.terminalScreenshotReadyTimeoutMs,
          MIN_TIMING_DELAY_MS,
          MAX_TIMING_DELAY_MS,
          DEFAULT_BRIDGE_SETTINGS.timing.terminalScreenshotReadyTimeoutMs
        ),
        appRestartDelayMs: clampInteger(
          this.state.bridgeSettings?.timing?.appRestartDelayMs,
          MIN_TIMING_DELAY_MS,
          MAX_TIMING_DELAY_MS,
          DEFAULT_BRIDGE_SETTINGS.timing.appRestartDelayMs
        ),
        attachmentDownloadTimeoutMs: clampInteger(
          this.state.bridgeSettings?.timing?.attachmentDownloadTimeoutMs,
          MIN_TIMING_DELAY_MS,
          MAX_TIMING_DELAY_MS,
          DEFAULT_BRIDGE_SETTINGS.timing.attachmentDownloadTimeoutMs
        )
      }
    };
  }

  setBridgeSettings(update: BridgeSettingsUpdate): BridgeSettings {
    const nextTiming = update.timing
      ? {
          ...this.state.bridgeSettings?.timing,
          ...update.timing
        }
      : undefined;
    if (nextTiming && update.timing?.inflightScreenshotDelayMs !== undefined) {
      nextTiming.inflightScreenshotDelaySeconds = Math.round(update.timing.inflightScreenshotDelayMs / 1000);
      delete nextTiming.inflightScreenshotDelayMs;
    }

    this.state.bridgeSettings = {
      ...this.state.bridgeSettings,
      ...(update.replyTextOnCompletion === undefined
        ? {}
        : { replyTextOnCompletion: Boolean(update.replyTextOnCompletion) }),
      ...(update.completionReplyMaxChars === undefined
        ? {}
        : { completionReplyMaxChars: update.completionReplyMaxChars }),
      ...(update.autoScreenshotOnReply === undefined
        ? {}
        : { autoScreenshotOnReply: Boolean(update.autoScreenshotOnReply) }),
      ...(update.inflightScreenshotOnRunningRequest === undefined
        ? {}
        : { inflightScreenshotOnRunningRequest: Boolean(update.inflightScreenshotOnRunningRequest) }),
      ...(update.replyFormat === undefined ? {} : { replyFormat: update.replyFormat }),
      ...(update.softTimeoutMs === undefined ? {} : { softTimeoutMs: update.softTimeoutMs }),
      ...(update.hardTimeoutMs === undefined ? {} : { hardTimeoutMs: update.hardTimeoutMs === null ? null : update.hardTimeoutMs }),
      ...(update.diffAnchorChars === undefined ? {} : { diffAnchorChars: update.diffAnchorChars }),
      ...(update.bridgeDimensions
        ? {
            bridgeDimensions: {
              ...this.state.bridgeSettings?.bridgeDimensions,
              ...update.bridgeDimensions
            }
          }
        : {}),
      ...(update.artifactPublish
        ? {
            artifactPublish: {
              ...this.state.bridgeSettings?.artifactPublish,
              ...update.artifactPublish
            }
          }
        : {}),
      ...(update.timing
        ? {
            timing: nextTiming
          }
        : {})
    };
    this.save();
    return this.getBridgeSettings();
  }

  ensureArtifactPublishDefaults(defaultRootCwd: string): BridgeSettings {
    const currentWatchDirectory = normalizeArtifactPublishPath(this.state.bridgeSettings?.artifactPublish?.watchDirectory);
    const nextWatchDirectory =
      currentWatchDirectory.length > 0 ? currentWatchDirectory : path.resolve(defaultRootCwd, 'discord-publish');

    this.state.bridgeSettings = {
      ...this.state.bridgeSettings,
      artifactPublish: {
        watchDirectory: nextWatchDirectory,
        channelId: normalizeDiscordChannelId(this.state.bridgeSettings?.artifactPublish?.channelId)
      }
    };
    this.save();
    mkdirSync(nextWatchDirectory, { recursive: true });
    return this.getBridgeSettings();
  }

  private load(): StoredPreferences {
    if (!existsSync(this.filePath)) {
      return {};
    }

    try {
      const raw = readFileSync(this.filePath, 'utf8');
      return JSON.parse(raw) as StoredPreferences;
    } catch {
      return {};
    }
  }

  private save(): void {
    const directory = path.dirname(this.filePath);
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true });
    }

    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  private ensureTerminalSlotsPersisted(): void {
    const normalizedSlots = this.getTerminalSlots();
    const currentSerialized = JSON.stringify(this.state.terminalSlots ?? []);
    const normalizedSerialized = JSON.stringify(normalizedSlots);
    if (currentSerialized === normalizedSerialized) {
      return;
    }

    this.state.terminalSlots = normalizedSlots;
    this.save();
  }

  private ensureWorkspacePaneLayoutPersisted(): void {
    const normalizedLayout = this.getWorkspacePaneLayout();
    const currentSerialized = JSON.stringify(this.state.workspacePaneLayout ?? {});
    const normalizedSerialized = JSON.stringify(normalizedLayout);
    if (currentSerialized === normalizedSerialized) {
      return;
    }

    this.state.workspacePaneLayout = normalizedLayout;
    this.save();
  }

  private removeLegacyDefaultWorkspaceCwd(): void {
    if (!('defaultWorkspaceCwd' in this.state)) {
      return;
    }

    delete (this.state as StoredPreferences & { defaultWorkspaceCwd?: string }).defaultWorkspaceCwd;
    this.save();
  }
}

function resolveInflightScreenshotDelayMs(
  timing: StoredBridgeTimingSettings | undefined
): number | undefined {
  if (!timing) {
    return undefined;
  }

  if (typeof timing.inflightScreenshotDelaySeconds === 'number') {
    return timing.inflightScreenshotDelaySeconds * 1000;
  }

  return timing.inflightScreenshotDelayMs;
}

function normalizeStartupCommandText(value: string | undefined): string {
  return value?.trim() ?? '';
}

function validateStartupCommandSettings(enabled: boolean, text: string): void {
  if (hasLineBreak(text)) {
    throw new Error('Startup command must be a single line.');
  }

  if (enabled && text.length === 0) {
    throw new Error('Startup command text is required when startup command is enabled.');
  }
}

function hasLineBreak(value: string): boolean {
  return /[\r\n]/.test(value);
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(value as number)));
}

function clampNullableInteger(value: number | null | undefined, min: number, max: number, fallback: number | null): number | null {
  if (value === null) {
    return null;
  }

  if (fallback === null) {
    return !Number.isFinite(value) ? null : Math.max(min, Math.min(max, Math.round(value as number)));
  }

  return clampInteger(value, min, max, fallback);
}

function normalizeWorkspacePaneLayout(
  layout: StoredPreferences['workspacePaneLayout'] | WorkspacePaneLayout | undefined
): WorkspacePaneLayout {
  const columnFractions = normalizeFractionVector(layout?.columnFractions, DEFAULT_WORKSPACE_PANE_LAYOUT.columnFractions);
  const rowFractions = normalizeFractionVector(layout?.rowFractions, DEFAULT_WORKSPACE_PANE_LAYOUT.rowFractions);
  return {
    columnFractions: [columnFractions[0], columnFractions[1], columnFractions[2], columnFractions[3]],
    rowFractions: [rowFractions[0], rowFractions[1]]
  };
}

function normalizeFractionVector(values: number[] | undefined, fallback: readonly number[]): number[] {
  if (!values || values.length !== fallback.length) {
    return [...fallback];
  }

  const normalized = values.map((value) => Number(value));
  if (normalized.some((value) => !Number.isFinite(value) || value <= 0)) {
    return [...fallback];
  }

  const total = normalized.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return [...fallback];
  }

  return normalized.map((value) => value / total);
}

function normalizeBridgeReplyFormat(value: BridgeReplyFormat | undefined): BridgeReplyFormat {
  return value === 'command' || value === 'plain-text' ? value : DEFAULT_BRIDGE_SETTINGS.replyFormat;
}

function normalizeArtifactPublishPath(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized ? path.resolve(normalized) : DEFAULT_BRIDGE_SETTINGS.artifactPublish.watchDirectory;
}

function normalizeDiscordChannelId(value: string | undefined): string {
  return value?.trim() ?? DEFAULT_BRIDGE_SETTINGS.artifactPublish.channelId;
}

function normalizeWorkspaceName(value: string | undefined, slotId: TerminalSlotId): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : `slot${slotId}`;
}
