import { useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react';
import type {
  AppLogEntry,
  BridgeReplyFormat,
  BootstrapState,
  BridgeSettings,
  TerminalSessionSummary,
  TerminalSlotId,
  TerminalSlotSettings,
  WorkspacePaneLayout
} from '../../shared/terminal';
import { TerminalViewport } from '../components/TerminalViewport';

interface SettingsDraft {
  replyTextOnCompletion: boolean;
  completionReplyMaxChars: string;
  autoScreenshotOnReply: boolean;
  inflightScreenshotOnRunningRequest: boolean;
  replyFormat: BridgeReplyFormat;
  softTimeoutSeconds: string;
  hardTimeoutSeconds: string;
  hardTimeoutUnlimited: boolean;
  artifactWatchDirectory: string;
  diffAnchorChars: string;
  bridgeCols: string;
  bridgeRows: string;
  inflightScreenshotDelaySeconds: string;
  redrawWaitAfterShrinkMs: string;
  beforeSendRedrawRestoreMs: string;
  afterCompleteRedrawRestoreMs: string;
  beforeSendPostRedrawDelayMs: string;
  preTextInputSnapshotDelayMs: string;
  textSubmitEnterDelayMs: string;
  repeatedControlKeyDelayMs: string;
  completionSettleMs: string;
  completionNoOutputTimeoutMs: string;
  completionPollIntervalMs: string;
  completionStablePollCount: string;
  manualRedrawWaitAfterShrinkMs: string;
  manualRedrawWaitAfterRestoreMs: string;
  liveViewSnapshotDebounceMs: string;
  snapshotMirrorFlushTimeoutMs: string;
  windowScreenshotCaptureDelayMs: string;
  terminalScreenshotResizeSettleMs: string;
  terminalScreenshotPollIntervalMs: string;
  terminalScreenshotReadyTimeoutMs: string;
  appRestartDelayMs: string;
  attachmentDownloadTimeoutMs: string;
}

type SettingsNumericField =
  | 'completionReplyMaxChars'
  | 'diffAnchorChars'
  | 'bridgeCols'
  | 'bridgeRows'
  | 'inflightScreenshotDelaySeconds'
  | 'redrawWaitAfterShrinkMs'
  | 'beforeSendRedrawRestoreMs'
  | 'afterCompleteRedrawRestoreMs'
  | 'beforeSendPostRedrawDelayMs'
  | 'preTextInputSnapshotDelayMs'
  | 'textSubmitEnterDelayMs'
  | 'repeatedControlKeyDelayMs'
  | 'completionSettleMs'
  | 'completionNoOutputTimeoutMs'
  | 'completionPollIntervalMs'
  | 'completionStablePollCount'
  | 'manualRedrawWaitAfterShrinkMs'
  | 'manualRedrawWaitAfterRestoreMs'
  | 'liveViewSnapshotDebounceMs'
  | 'snapshotMirrorFlushTimeoutMs'
  | 'windowScreenshotCaptureDelayMs'
  | 'terminalScreenshotResizeSettleMs'
  | 'terminalScreenshotPollIntervalMs'
  | 'terminalScreenshotReadyTimeoutMs'
  | 'appRestartDelayMs'
  | 'attachmentDownloadTimeoutMs';

const MIN_BRIDGE_COLS = 40;
const MAX_BRIDGE_COLS = 400;
const MIN_BRIDGE_ROWS = 15;
const MAX_BRIDGE_ROWS = 120;
const MIN_SOFT_TIMEOUT_MS = 1000;
const MAX_SOFT_TIMEOUT_MS = 300000;
const MIN_HARD_TIMEOUT_MS = 5000;
const MAX_HARD_TIMEOUT_MS = 7200000;
const MIN_TIMING_DELAY_MS = 0;
const MAX_TIMING_DELAY_MS = 120000;
const MIN_TIMING_COUNT = 1;
const MAX_TIMING_COUNT = 20;
const DEFAULT_HARD_TIMEOUT_MS = 7200000;
const MIN_SOFT_TIMEOUT_SECONDS = MIN_SOFT_TIMEOUT_MS / 1000;
const MAX_SOFT_TIMEOUT_SECONDS = MAX_SOFT_TIMEOUT_MS / 1000;
const MIN_HARD_TIMEOUT_SECONDS = MIN_HARD_TIMEOUT_MS / 1000;
const MAX_HARD_TIMEOUT_SECONDS = MAX_HARD_TIMEOUT_MS / 1000;
const DEFAULT_HARD_TIMEOUT_SECONDS = DEFAULT_HARD_TIMEOUT_MS / 1000;
const MIN_INFLIGHT_SCREENSHOT_DELAY_SECONDS = MIN_TIMING_DELAY_MS / 1000;
const MAX_INFLIGHT_SCREENSHOT_DELAY_SECONDS = MAX_TIMING_DELAY_MS / 1000;
const MIN_COMPLETION_REPLY_MAX_CHARS = 100;
const MAX_COMPLETION_REPLY_MAX_CHARS = 20000;
const MIN_DIFF_ANCHOR_CHARS = 50;
const MAX_DIFF_ANCHOR_CHARS = 5000;
const MAX_RENDERED_APP_LOGS = 2000;
const SLOT_LAYOUT_ORDER: TerminalSlotId[] = [1, 3, 5, 7, 2, 4, 6, 8];
const WORKSPACE_DIVIDER_SIZE_PX = 10;
const WORKSPACE_PADDING_PX = 10;
const MIN_WORKSPACE_COLUMN_SIZE_PX = 220;
const MIN_WORKSPACE_ROW_SIZE_PX = 160;
const DEFAULT_WORKSPACE_PANE_LAYOUT: WorkspacePaneLayout = {
  columnFractions: [0.25, 0.25, 0.25, 0.25],
  rowFractions: [0.5, 0.5]
};
const WORKSPACE_COLUMN_GRID_COLUMNS = ['1', '3', '5', '7'] as const;
const WORKSPACE_VERTICAL_DIVIDERS = [
  { id: 'vertical-1', gridColumn: '2', ariaLabel: 'Resize first and second columns' },
  { id: 'vertical-2', gridColumn: '4', ariaLabel: 'Resize second and third columns' },
  { id: 'vertical-3', gridColumn: '6', ariaLabel: 'Resize third and fourth columns' }
] as const;

type WorkspaceDivider = (typeof WORKSPACE_VERTICAL_DIVIDERS)[number]['id'] | 'horizontal';

export function App() {
  const [bootstrapState, setBootstrapState] = useState<BootstrapState | null>(null);
  const [sessions, setSessions] = useState<TerminalSessionSummary[]>([]);
  const [slotSettings, setSlotSettings] = useState<TerminalSlotSettings[]>([]);
  const [appLogs, setAppLogs] = useState<AppLogEntry[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [bridgeSettings, setBridgeSettings] = useState<BridgeSettings>({
    replyTextOnCompletion: true,
    completionReplyMaxChars: 5000,
    autoScreenshotOnReply: true,
    inflightScreenshotOnRunningRequest: true,
    replyFormat: 'command',
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
  });
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>({
    replyTextOnCompletion: true,
    completionReplyMaxChars: '5000',
    autoScreenshotOnReply: true,
    inflightScreenshotOnRunningRequest: true,
    replyFormat: 'command',
    softTimeoutSeconds: '300',
    hardTimeoutSeconds: String(DEFAULT_HARD_TIMEOUT_SECONDS),
    hardTimeoutUnlimited: true,
    artifactWatchDirectory: '',
    diffAnchorChars: '300',
    bridgeCols: '100',
    bridgeRows: '50',
    inflightScreenshotDelaySeconds: '10',
    redrawWaitAfterShrinkMs: '500',
    beforeSendRedrawRestoreMs: '1500',
    afterCompleteRedrawRestoreMs: '1000',
    beforeSendPostRedrawDelayMs: '500',
    preTextInputSnapshotDelayMs: '500',
    textSubmitEnterDelayMs: '500',
    repeatedControlKeyDelayMs: '100',
    completionSettleMs: '2000',
    completionNoOutputTimeoutMs: '3000',
    completionPollIntervalMs: '500',
    completionStablePollCount: '3',
    manualRedrawWaitAfterShrinkMs: '150',
    manualRedrawWaitAfterRestoreMs: '250',
    liveViewSnapshotDebounceMs: '120',
    snapshotMirrorFlushTimeoutMs: '2000',
    windowScreenshotCaptureDelayMs: '100',
    terminalScreenshotResizeSettleMs: '120',
    terminalScreenshotPollIntervalMs: '50',
    terminalScreenshotReadyTimeoutMs: '10000',
    appRestartDelayMs: '500',
    attachmentDownloadTimeoutMs: '30000'
  });
  const [slotDrafts, setSlotDrafts] = useState<TerminalSlotSettings[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [restartingSlotId, setRestartingSlotId] = useState<TerminalSlotId | null>(null);
  const [redrawingSlotId, setRedrawingSlotId] = useState<TerminalSlotId | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [workspacePaneLayout, setWorkspacePaneLayout] = useState<WorkspacePaneLayout>(DEFAULT_WORKSPACE_PANE_LAYOUT);
  const [activeDivider, setActiveDivider] = useState<WorkspaceDivider | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const snapshotPublishTimerRef = useRef<number | null>(null);
  const appLogViewportRef = useRef<HTMLDivElement | null>(null);
  const workspaceGridRef = useRef<HTMLElement | null>(null);
  const workspacePaneLayoutRef = useRef<WorkspacePaneLayout>(DEFAULT_WORKSPACE_PANE_LAYOUT);
  const persistedWorkspacePaneLayoutRef = useRef<WorkspacePaneLayout>(DEFAULT_WORKSPACE_PANE_LAYOUT);
  const workspaceLayoutSaveTokenRef = useRef(0);

  useEffect(() => {
    const unsubscribeUpdated = window.terminalApp.onSessionUpdated((session) => {
      setSessions((current) => upsertSession(current, session));
      setActiveSessionId((current) => current ?? session.id);
      scheduleViewSnapshotPublish();
    });

    const unsubscribeExit = window.terminalApp.onSessionExit(({ sessionId }) => {
      setRenamingSessionId((current) => (current === sessionId ? null : current));
      scheduleViewSnapshotPublish();
    });
    const unsubscribeActivated = window.terminalApp.onSessionActivated(({ sessionId }) => {
      setActiveSessionId(sessionId);
    });

    const unsubscribeData = window.terminalApp.onSessionData((_event) => {
      scheduleViewSnapshotPublish();
    });
    const unsubscribeAppLogEntry = window.terminalApp.onAppLogEntry((entry) => {
      setAppLogs((current) => appendAppLogEntry(current, entry));
    });

    void (async () => {
      const state = await window.terminalApp.bootstrap();
      setBootstrapState(state);
      setSessions(state.sessions);
      setSlotSettings(state.terminalSlots);
      setAppLogs(state.appLogs);
      setBridgeSettings(state.bridgeSettings);
      setWorkspacePaneLayout(state.workspacePaneLayout);
      persistedWorkspacePaneLayoutRef.current = state.workspacePaneLayout;
      setSettingsDraft(createSettingsDraft(state.bridgeSettings));
      setSlotDrafts(state.terminalSlots);
      setActiveSessionId(state.sessions[0]?.id ?? null);
    })();

    return () => {
      unsubscribeUpdated();
      unsubscribeExit();
      unsubscribeActivated();
      unsubscribeData();
      unsubscribeAppLogEntry();
      if (snapshotPublishTimerRef.current !== null) {
        window.clearTimeout(snapshotPublishTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!logsOpen || !appLogViewportRef.current) {
      return;
    }

    appLogViewportRef.current.scrollTop = appLogViewportRef.current.scrollHeight;
  }, [logsOpen, appLogs]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
    scheduleViewSnapshotPublish();
  }, [activeSessionId, sessions]);

  useEffect(() => {
    workspacePaneLayoutRef.current = workspacePaneLayout;
  }, [workspacePaneLayout]);

  useEffect(() => {
    if (!activeDivider) {
      return;
    }

    const resizeCursorClass = activeDivider === 'horizontal' ? 'workspace-resize-active-row' : 'workspace-resize-active-col';

    const handlePointerMove = (event: PointerEvent) => {
      const nextLayout = calculateWorkspacePaneLayout(
        activeDivider,
        workspacePaneLayoutRef.current,
        workspaceGridRef.current,
        event.clientX,
        event.clientY
      );
      if (!areWorkspacePaneLayoutsEqual(nextLayout, workspacePaneLayoutRef.current)) {
        setWorkspacePaneLayout(nextLayout);
      }
    };

    const finishDrag = () => {
      const finalLayout = workspacePaneLayoutRef.current;
      setActiveDivider(null);
      if (!areWorkspacePaneLayoutsEqual(finalLayout, persistedWorkspacePaneLayoutRef.current)) {
        void persistWorkspacePaneLayout(finalLayout);
      }
    };

    document.body.classList.add('workspace-resize-active', resizeCursorClass);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
    return () => {
      document.body.classList.remove('workspace-resize-active', 'workspace-resize-active-col', 'workspace-resize-active-row');
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
    };
  }, [activeDivider]);

  const slots = useMemo(
    () => orderSlotsForLayout(slotSettings),
    [slotSettings]
  );

  const sessionsBySlot = useMemo(() => {
    const map = new Map<TerminalSlotId, TerminalSessionSummary>();
    for (const session of sessions) {
      if (session.slotId) {
        map.set(session.slotId, session);
      }
    }
    return map;
  }, [sessions]);
  const appLogText = useMemo(() => appLogs.map((entry) => entry.text).join(''), [appLogs]);
  const workspaceGridStyle = useMemo(() => createWorkspaceGridStyle(workspacePaneLayout), [workspacePaneLayout]);
  const workspaceOverlayOpen = logsOpen || settingsOpen;

  useEffect(() => {
    if (!workspaceOverlayOpen || !activeDivider) {
      return;
    }

    setActiveDivider(null);
  }, [workspaceOverlayOpen, activeDivider]);

  function scheduleViewSnapshotPublish() {
    if (snapshotPublishTimerRef.current !== null) {
      window.clearTimeout(snapshotPublishTimerRef.current);
    }

    snapshotPublishTimerRef.current = window.setTimeout(() => {
      snapshotPublishTimerRef.current = null;
      void window.terminalApp.publishLiveViewSnapshot({
        activeSessionId: activeSessionIdRef.current
      });
    }, bridgeSettings.timing.liveViewSnapshotDebounceMs);
  }

  async function persistWorkspacePaneLayout(layout: WorkspacePaneLayout) {
    const saveToken = ++workspaceLayoutSaveTokenRef.current;
    try {
      const persistedLayout = await window.terminalApp.updateWorkspacePaneLayout(layout);
      if (saveToken !== workspaceLayoutSaveTokenRef.current) {
        return;
      }

      persistedWorkspacePaneLayoutRef.current = persistedLayout;
      setWorkspacePaneLayout(persistedLayout);
      setBootstrapState((current) => (current ? { ...current, workspacePaneLayout: persistedLayout } : current));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(`ペインサイズの保存に失敗しました: ${message}`);
    }
  }

  function handleWorkspaceDividerPointerDown(divider: WorkspaceDivider, event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setActiveDivider(divider);
  }

  function openSettings() {
    setLogsOpen(false);
    setSettingsError(null);
    setSettingsDraft(createSettingsDraft(bridgeSettings));
    setSlotDrafts(slotSettings);
    setSettingsOpen(true);
  }

  function closeSettings() {
    if (isSavingSettings) {
      return;
    }

    setSettingsOpen(false);
    setSettingsError(null);
  }

  function openLogs() {
    setSettingsOpen(false);
    setLogsOpen(true);
  }

  function closeLogs() {
    setLogsOpen(false);
  }

  async function saveSettings() {
    const softTimeoutSeconds = parseBoundedInteger(settingsDraft.softTimeoutSeconds, MIN_SOFT_TIMEOUT_SECONDS, MAX_SOFT_TIMEOUT_SECONDS);
    const softTimeoutMs = softTimeoutSeconds * 1000;
    const hardTimeoutSeconds = settingsDraft.hardTimeoutUnlimited
      ? null
      : parseBoundedInteger(settingsDraft.hardTimeoutSeconds, MIN_HARD_TIMEOUT_SECONDS, MAX_HARD_TIMEOUT_SECONDS);
    const hardTimeoutMs = hardTimeoutSeconds === null ? null : hardTimeoutSeconds * 1000;
    const completionReplyMaxChars = parseBoundedInteger(
      settingsDraft.completionReplyMaxChars,
      MIN_COMPLETION_REPLY_MAX_CHARS,
      MAX_COMPLETION_REPLY_MAX_CHARS
    );
    const diffAnchorChars = parseBoundedInteger(settingsDraft.diffAnchorChars, MIN_DIFF_ANCHOR_CHARS, MAX_DIFF_ANCHOR_CHARS);
    const cols = parseBoundedInteger(settingsDraft.bridgeCols, MIN_BRIDGE_COLS, MAX_BRIDGE_COLS);
    const rows = parseBoundedInteger(settingsDraft.bridgeRows, MIN_BRIDGE_ROWS, MAX_BRIDGE_ROWS);
    const inflightScreenshotDelaySeconds = parseBoundedInteger(
      settingsDraft.inflightScreenshotDelaySeconds,
      MIN_INFLIGHT_SCREENSHOT_DELAY_SECONDS,
      MAX_INFLIGHT_SCREENSHOT_DELAY_SECONDS
    );
    const inflightScreenshotDelayMs = inflightScreenshotDelaySeconds * 1000;
    const artifactWatchDirectory = settingsDraft.artifactWatchDirectory.trim();
    const redrawWaitAfterShrinkMs = parseBoundedInteger(settingsDraft.redrawWaitAfterShrinkMs, MIN_TIMING_DELAY_MS, MAX_TIMING_DELAY_MS);
    const beforeSendRedrawRestoreMs = parseBoundedInteger(
      settingsDraft.beforeSendRedrawRestoreMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const afterCompleteRedrawRestoreMs = parseBoundedInteger(
      settingsDraft.afterCompleteRedrawRestoreMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const beforeSendPostRedrawDelayMs = parseBoundedInteger(
      settingsDraft.beforeSendPostRedrawDelayMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const preTextInputSnapshotDelayMs = parseBoundedInteger(
      settingsDraft.preTextInputSnapshotDelayMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const textSubmitEnterDelayMs = parseBoundedInteger(
      settingsDraft.textSubmitEnterDelayMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const repeatedControlKeyDelayMs = parseBoundedInteger(
      settingsDraft.repeatedControlKeyDelayMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const completionSettleMs = parseBoundedInteger(settingsDraft.completionSettleMs, MIN_TIMING_DELAY_MS, MAX_TIMING_DELAY_MS);
    const completionNoOutputTimeoutMs = parseBoundedInteger(
      settingsDraft.completionNoOutputTimeoutMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const completionPollIntervalMs = parseBoundedInteger(
      settingsDraft.completionPollIntervalMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const completionStablePollCount = parseBoundedInteger(
      settingsDraft.completionStablePollCount,
      MIN_TIMING_COUNT,
      MAX_TIMING_COUNT
    );
    const manualRedrawWaitAfterShrinkMs = parseBoundedInteger(
      settingsDraft.manualRedrawWaitAfterShrinkMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const manualRedrawWaitAfterRestoreMs = parseBoundedInteger(
      settingsDraft.manualRedrawWaitAfterRestoreMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const liveViewSnapshotDebounceMs = parseBoundedInteger(
      settingsDraft.liveViewSnapshotDebounceMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const snapshotMirrorFlushTimeoutMs = parseBoundedInteger(
      settingsDraft.snapshotMirrorFlushTimeoutMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const windowScreenshotCaptureDelayMs = parseBoundedInteger(
      settingsDraft.windowScreenshotCaptureDelayMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const terminalScreenshotResizeSettleMs = parseBoundedInteger(
      settingsDraft.terminalScreenshotResizeSettleMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const terminalScreenshotPollIntervalMs = parseBoundedInteger(
      settingsDraft.terminalScreenshotPollIntervalMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const terminalScreenshotReadyTimeoutMs = parseBoundedInteger(
      settingsDraft.terminalScreenshotReadyTimeoutMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const appRestartDelayMs = parseBoundedInteger(
      settingsDraft.appRestartDelayMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    const attachmentDownloadTimeoutMs = parseBoundedInteger(
      settingsDraft.attachmentDownloadTimeoutMs,
      MIN_TIMING_DELAY_MS,
      MAX_TIMING_DELAY_MS
    );
    if (artifactWatchDirectory.length === 0) {
      setSettingsError('Enter an artifact publish folder.');
      return;
    }

    if (
      !Number.isFinite(softTimeoutSeconds) ||
      (!settingsDraft.hardTimeoutUnlimited && !Number.isFinite(hardTimeoutSeconds)) ||
      !Number.isFinite(completionReplyMaxChars) ||
      !Number.isFinite(diffAnchorChars) ||
      !Number.isFinite(cols) ||
      !Number.isFinite(rows) ||
      !Number.isFinite(inflightScreenshotDelaySeconds) ||
      !Number.isFinite(redrawWaitAfterShrinkMs) ||
      !Number.isFinite(beforeSendRedrawRestoreMs) ||
      !Number.isFinite(afterCompleteRedrawRestoreMs) ||
      !Number.isFinite(beforeSendPostRedrawDelayMs) ||
      !Number.isFinite(preTextInputSnapshotDelayMs) ||
      !Number.isFinite(textSubmitEnterDelayMs) ||
      !Number.isFinite(repeatedControlKeyDelayMs) ||
      !Number.isFinite(completionSettleMs) ||
      !Number.isFinite(completionNoOutputTimeoutMs) ||
      !Number.isFinite(completionPollIntervalMs) ||
      !Number.isFinite(completionStablePollCount) ||
      !Number.isFinite(manualRedrawWaitAfterShrinkMs) ||
      !Number.isFinite(manualRedrawWaitAfterRestoreMs) ||
      !Number.isFinite(liveViewSnapshotDebounceMs) ||
      !Number.isFinite(snapshotMirrorFlushTimeoutMs) ||
      !Number.isFinite(windowScreenshotCaptureDelayMs) ||
      !Number.isFinite(terminalScreenshotResizeSettleMs) ||
      !Number.isFinite(terminalScreenshotPollIntervalMs) ||
      !Number.isFinite(terminalScreenshotReadyTimeoutMs) ||
      !Number.isFinite(appRestartDelayMs) ||
      !Number.isFinite(attachmentDownloadTimeoutMs)
    ) {
      setSettingsError('Check the numeric settings.');
      return;
    }

    setIsSavingSettings(true);
    setSettingsError(null);
    setFeedback(null);

    try {
      const sanitizedSlotDrafts = slotDrafts.map((slotDraft) => {
        if (hasLineBreak(slotDraft.startupCommandText)) {
          throw new Error(`slot${slotDraft.slotId}: Startup command must be a single line.`);
        }

        const startupCommandText = slotDraft.startupCommandText.trim();
        if (slotDraft.startupCommandEnabled && startupCommandText.length === 0) {
          throw new Error(`slot${slotDraft.slotId}: Enter a startup command or turn the setting off.`);
        }

        return {
          ...slotDraft,
          startupCommandText
        };
      });

      const updatedBridgeSettings = await window.terminalApp.updateBridgeSettings({
        replyTextOnCompletion: settingsDraft.replyTextOnCompletion,
        completionReplyMaxChars,
        autoScreenshotOnReply: settingsDraft.autoScreenshotOnReply,
        inflightScreenshotOnRunningRequest: settingsDraft.inflightScreenshotOnRunningRequest,
        replyFormat: settingsDraft.replyFormat,
        softTimeoutMs,
        hardTimeoutMs,
        diffAnchorChars,
        artifactPublish: {
          watchDirectory: artifactWatchDirectory
        },
        bridgeDimensions: {
          cols,
          rows
        },
        timing: {
          inflightScreenshotDelayMs,
          redrawWaitAfterShrinkMs,
          beforeSendRedrawRestoreMs,
          afterCompleteRedrawRestoreMs,
          beforeSendPostRedrawDelayMs,
          preTextInputSnapshotDelayMs,
          textSubmitEnterDelayMs,
          repeatedControlKeyDelayMs,
          completionSettleMs,
          completionNoOutputTimeoutMs,
          completionPollIntervalMs,
          completionStablePollCount,
          manualRedrawWaitAfterShrinkMs,
          manualRedrawWaitAfterRestoreMs,
          liveViewSnapshotDebounceMs,
          snapshotMirrorFlushTimeoutMs,
          windowScreenshotCaptureDelayMs,
          terminalScreenshotResizeSettleMs,
          terminalScreenshotPollIntervalMs,
          terminalScreenshotReadyTimeoutMs,
          appRestartDelayMs,
          attachmentDownloadTimeoutMs
        }
      });
      setBridgeSettings(updatedBridgeSettings);

      const updatedSlots: TerminalSlotSettings[] = [];
      for (const slotDraft of sanitizedSlotDrafts) {
        const result = await window.terminalApp.updateTerminalSlot(slotDraft);
        updatedSlots.push(result.slot);
        if (result.session) {
          const session = result.session;
          setSessions((current) => upsertSession(current, session));
        }
      }

      setSlotSettings(updatedSlots);
      setBootstrapState((current) =>
        current
          ? {
              ...current,
              bridgeSettings: updatedBridgeSettings,
              terminalSlots: updatedSlots
            }
          : current
      );
      setSettingsOpen(false);
      setFeedback('Settings saved.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSettingsError(message);
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function restartSlot(slotId: TerminalSlotId) {
    const slotName = findSlotName(slotSettings, slotId);
    if (!window.confirm(`${slotName} を再起動しますか？\n現在のターミナルセッションは終了して、新しいセッションに置き換わります。`)) {
      return;
    }

    setRestartingSlotId(slotId);
    setFeedback(null);
    try {
      const session = await window.terminalApp.restartTerminalSlot(slotId);
      setSessions((current) => upsertSession(current, session));
      setActiveSessionId(session.id);
      setFeedback(`${slotName} を再起動しました。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(`再起動に失敗しました: ${message}`);
    } finally {
      setRestartingSlotId(null);
    }
  }

  async function redrawSlot(slotId: TerminalSlotId, session: TerminalSessionSummary) {
    setRedrawingSlotId(slotId);
    setFeedback(null);
    try {
      await window.terminalApp.redrawJiggle({
        sessionId: session.id
      });
      scheduleViewSnapshotPublish();
      setFeedback(`${findSlotName(slotSettings, slotId)} を再描画しました。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(`再描画に失敗しました: ${message}`);
    } finally {
      setRedrawingSlotId(null);
    }
  }

  async function submitRenameSession(session: TerminalSessionSummary, nextTitle: string) {
    try {
      const updated = await window.terminalApp.renameSession({
        sessionId: session.id,
        title: nextTitle.trim()
      });
      setSessions((current) => upsertSession(current, updated));
      setSlotSettings((current) =>
        current.map((slot) => (slot.slotId === session.slotId ? { ...slot, workspaceName: updated.title ?? slot.workspaceName } : slot))
      );
      setRenamingSessionId(null);
      setRenameDraft('');
      if (updated.title) {
        setFeedback(`ワークスペース名を ${updated.title} に変更しました。`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(`名前変更に失敗しました: ${message}`);
    }
  }

  function beginRenameSession(session: TerminalSessionSummary) {
    setRenamingSessionId(session.id);
    setRenameDraft(session.title ?? findSlotName(slotSettings, session.slotId));
  }

  function cancelRenameSession() {
    setRenamingSessionId(null);
    setRenameDraft('');
  }

  function handleRenameKeyDown(event: ReactKeyboardEvent<HTMLInputElement>, session: TerminalSessionSummary) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submitRenameSession(session, renameDraft);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelRenameSession();
    }
  }

  return (
    <div className="app-shell">
      <div className="workspace-shell">
        <header className="titlebar titlebar--main">
          <div className="titlebar__left">
            <span className="titlebar__eyebrow">multicli</span>
            <span className="titlebar__title">discord-bridge</span>
            {feedback ? <span className="titlebar__feedback">{feedback}</span> : null}
          </div>
          <div className="titlebar__actions">
            <button className={logsOpen ? 'action-button action-button--selected' : 'action-button'} onClick={openLogs}>
              Logs
            </button>
            <button className="action-button" onClick={openSettings}>
              Settings
            </button>
          </div>
        </header>

        <main ref={workspaceGridRef} className="terminal-grid" style={workspaceGridStyle}>
          {slots.map((slot, index) => {
            const session = sessionsBySlot.get(slot.slotId) ?? null;
            const renaming = session && renamingSessionId === session.id;
            const status = getPaneStatus(session);
            return (
              <section
                key={slot.slotId}
                className={activeSessionId === session?.id ? 'terminal-tile terminal-tile--active' : 'terminal-tile'}
                style={getWorkspaceGridPosition(index)}
                onMouseDown={() => {
                  if (session) {
                    setActiveSessionId(session.id);
                  }
                }}
              >
                <div className="terminal-tile__header">
                  <div className="terminal-tile__header-main">
                    <span className="terminal-tile__slot-label">slot{slot.slotId}</span>
                    {session && renaming ? (
                      <div className="rename-editor">
                        <input
                          className="rename-editor__input"
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onKeyDown={(event) => handleRenameKeyDown(event, session)}
                          autoFocus
                        />
                        <button className="action-button action-button--compact" onClick={() => void submitRenameSession(session, renameDraft)}>
                          Save
                        </button>
                        <button className="action-button action-button--compact" onClick={cancelRenameSession}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        className="terminal-tile__title"
                        onDoubleClick={() => {
                          if (session) {
                            beginRenameSession(session);
                          }
                        }}
                      >
                        {session?.title ?? slot.workspaceName}
                      </button>
                    )}
                  </div>
                  <div className="terminal-tile__header-actions">
                    <span className={status.className}>{status.label}</span>
                    <button
                      className="action-button action-button--compact"
                      onClick={() => {
                        if (session) {
                          void redrawSlot(slot.slotId, session);
                        }
                      }}
                      disabled={!session || redrawingSlotId === slot.slotId || restartingSlotId === slot.slotId}
                    >
                      Redraw
                    </button>
                    <button
                      className="action-button action-button--compact"
                      onClick={() => void restartSlot(slot.slotId)}
                      disabled={restartingSlotId === slot.slotId || redrawingSlotId === slot.slotId}
                    >
                      Restart
                    </button>
                  </div>
                </div>

                <div className="terminal-tile__body">
                  {session ? (
                    <TerminalViewport
                      session={session}
                      focused={activeSessionId === session.id}
                      onActivate={() => setActiveSessionId(session.id)}
                    />
                  ) : (
                    <div className="terminal-tile__placeholder">
                      <div className="terminal-tile__placeholder-title">Terminal unavailable</div>
                      <div className="terminal-tile__placeholder-body">Restart でこの slot のターミナルを再作成できます。</div>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
          {!workspaceOverlayOpen ? (
            <>
              {WORKSPACE_VERTICAL_DIVIDERS.map((divider) => (
                <div
                  key={divider.id}
                  className={activeDivider === divider.id ? 'terminal-grid__divider terminal-grid__divider--vertical terminal-grid__divider--active' : 'terminal-grid__divider terminal-grid__divider--vertical'}
                  style={{ gridColumn: divider.gridColumn, gridRow: '1 / 4' }}
                  role="separator"
                  aria-label={divider.ariaLabel}
                  aria-orientation="vertical"
                  onPointerDown={(event) => handleWorkspaceDividerPointerDown(divider.id, event)}
                />
              ))}
              <div
                className={activeDivider === 'horizontal' ? 'terminal-grid__divider terminal-grid__divider--horizontal terminal-grid__divider--active' : 'terminal-grid__divider terminal-grid__divider--horizontal'}
                style={{ gridColumn: '1 / 8', gridRow: '2' }}
                role="separator"
                aria-label="Resize top and bottom rows"
                aria-orientation="horizontal"
                onPointerDown={(event) => handleWorkspaceDividerPointerDown('horizontal', event)}
              />
            </>
          ) : null}
        </main>
      </div>

      {logsOpen ? (
        <div className="settings-screen" role="dialog" aria-modal="true">
          <div className="log-screen__panel">
            <header className="settings-screen__header">
              <div>
                <div className="settings-screen__title">Logs</div>
                <div className="settings-screen__subtitle">Main process stdout, stderr, and terminal input/action logs.</div>
              </div>
              <button className="action-button" onClick={closeLogs}>
                Close
              </button>
            </header>
            <div ref={appLogViewportRef} className="app-log-panel__viewport app-log-panel__viewport--overlay">
              {appLogText.length > 0 ? (
                <pre className="app-log-panel__content">{appLogText}</pre>
              ) : (
                <div className="app-log-panel__empty">No logs yet.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="settings-screen" role="dialog" aria-modal="true">
          <div className="settings-screen__panel">
            <header className="settings-screen__header">
              <div>
                <div className="settings-screen__title">Settings</div>
                <div className="settings-screen__subtitle">Global settings and per-slot settings</div>
              </div>
              <button className="action-button" onClick={closeSettings} disabled={isSavingSettings}>
                Close
              </button>
            </header>

            <div className="settings-screen__content">
              <section className="settings-section">
                <h2 className="settings-section__title">Global</h2>
                <div className="settings-form">
                  <div className="settings-group">
                    <div className="settings-group__header">
                      <h3 className="settings-group__title">Replies and visibility</h3>
                      <p className="settings-group__description">Control how Discord replies, interim screenshots, and diff extraction are presented.</p>
                    </div>
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={settingsDraft.replyTextOnCompletion}
                        onChange={(event) =>
                          setSettingsDraft((current) => ({
                            ...current,
                            replyTextOnCompletion: event.target.checked
                          }))
                        }
                      />
                      <div className="settings-toggle__body">
                        <div className="settings-toggle__title">Completion text reply</div>
                        <div className="settings-toggle__description">Send diff-based text back to Discord after a text or control request completes.</div>
                      </div>
                    </label>
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={settingsDraft.autoScreenshotOnReply}
                        onChange={(event) =>
                          setSettingsDraft((current) => ({
                            ...current,
                            autoScreenshotOnReply: event.target.checked
                          }))
                        }
                      />
                      <div className="settings-toggle__body">
                        <div className="settings-toggle__title">Auto screenshot after reply</div>
                        <div className="settings-toggle__description">Attach an app-window screenshot after each completed Discord reply.</div>
                      </div>
                    </label>
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={settingsDraft.inflightScreenshotOnRunningRequest}
                        onChange={(event) =>
                          setSettingsDraft((current) => ({
                            ...current,
                            inflightScreenshotOnRunningRequest: event.target.checked
                          }))
                        }
                      />
                      <div className="settings-toggle__body">
                        <div className="settings-toggle__title">Delayed inflight terminal screenshot</div>
                        <div className="settings-toggle__description">
                          Send one interim terminal screenshot when a text or control request is still running after the configured delay.
                        </div>
                      </div>
                    </label>
                    <div className="settings-grid settings-grid--compact">
                      <label className="settings-field">
                        <span className="settings-field__label">{`Completion text max chars (${MIN_COMPLETION_REPLY_MAX_CHARS}-${MAX_COMPLETION_REPLY_MAX_CHARS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_COMPLETION_REPLY_MAX_CHARS}
                          max={MAX_COMPLETION_REPLY_MAX_CHARS}
                          step={1}
                          value={settingsDraft.completionReplyMaxChars}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'completionReplyMaxChars',
                              event.target.value,
                              MIN_COMPLETION_REPLY_MAX_CHARS,
                              MAX_COMPLETION_REPLY_MAX_CHARS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'completionReplyMaxChars',
                              settingsDraft.completionReplyMaxChars,
                              MIN_COMPLETION_REPLY_MAX_CHARS,
                              MAX_COMPLETION_REPLY_MAX_CHARS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">Discord reply format</span>
                        <select
                          className="settings-field__input"
                          value={settingsDraft.replyFormat}
                          onChange={(event) =>
                            setSettingsDraft((current) => ({
                              ...current,
                              replyFormat: event.target.value as BridgeReplyFormat
                            }))
                          }
                        >
                          <option value="command">Code block</option>
                          <option value="plain-text">Plain text</option>
                        </select>
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Inflight screenshot delay (s, ${MIN_INFLIGHT_SCREENSHOT_DELAY_SECONDS}-${MAX_INFLIGHT_SCREENSHOT_DELAY_SECONDS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_INFLIGHT_SCREENSHOT_DELAY_SECONDS}
                          max={MAX_INFLIGHT_SCREENSHOT_DELAY_SECONDS}
                          step={1}
                          value={settingsDraft.inflightScreenshotDelaySeconds}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'inflightScreenshotDelaySeconds',
                              event.target.value,
                              MIN_INFLIGHT_SCREENSHOT_DELAY_SECONDS,
                              MAX_INFLIGHT_SCREENSHOT_DELAY_SECONDS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'inflightScreenshotDelaySeconds',
                              settingsDraft.inflightScreenshotDelaySeconds,
                              MIN_INFLIGHT_SCREENSHOT_DELAY_SECONDS,
                              MAX_INFLIGHT_SCREENSHOT_DELAY_SECONDS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Screen diff anchor chars (${MIN_DIFF_ANCHOR_CHARS}-${MAX_DIFF_ANCHOR_CHARS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_DIFF_ANCHOR_CHARS}
                          max={MAX_DIFF_ANCHOR_CHARS}
                          step={1}
                          value={settingsDraft.diffAnchorChars}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'diffAnchorChars',
                              event.target.value,
                              MIN_DIFF_ANCHOR_CHARS,
                              MAX_DIFF_ANCHOR_CHARS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'diffAnchorChars',
                              settingsDraft.diffAnchorChars,
                              MIN_DIFF_ANCHOR_CHARS,
                              MAX_DIFF_ANCHOR_CHARS
                            )
                          }
                        />
                      </label>
                    </div>
                  </div>

                  <div className="settings-group">
                    <div className="settings-group__header">
                      <h3 className="settings-group__title">Session limits</h3>
                      <p className="settings-group__description">Tune how long the bridge waits before considering a request stalled or timed out.</p>
                    </div>
                    <div className="settings-grid settings-grid--compact">
                      <label className="settings-field">
                        <span className="settings-field__label">Soft timeout (s)</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_SOFT_TIMEOUT_SECONDS}
                          max={MAX_SOFT_TIMEOUT_SECONDS}
                          step={1}
                          value={settingsDraft.softTimeoutSeconds}
                          onChange={(event) =>
                            setSettingsDraft((current) => ({
                              ...current,
                              softTimeoutSeconds: event.target.value
                            }))
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">Hard timeout (s)</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_HARD_TIMEOUT_SECONDS}
                          max={MAX_HARD_TIMEOUT_SECONDS}
                          step={1}
                          value={settingsDraft.hardTimeoutSeconds}
                          disabled={settingsDraft.hardTimeoutUnlimited}
                          onChange={(event) =>
                            setSettingsDraft((current) => ({
                              ...current,
                              hardTimeoutSeconds: event.target.value
                            }))
                          }
                        />
                      </label>
                    </div>
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={settingsDraft.hardTimeoutUnlimited}
                        onChange={(event) =>
                          setSettingsDraft((current) => ({
                            ...current,
                            hardTimeoutUnlimited: event.target.checked
                          }))
                        }
                      />
                      <div className="settings-toggle__body">
                        <span className="settings-toggle__title">Unlimited hard timeout</span>
                        <span className="settings-toggle__description">Disable the forced timeout and wait until completion or manual stop.</span>
                      </div>
                    </label>
                  </div>

                  <div className="settings-group">
                    <div className="settings-group__header">
                      <h3 className="settings-group__title">Layout and artifact publishing</h3>
                      <p className="settings-group__description">Set the fixed bridge size and the shared folder and channel used for artifact uploads.</p>
                    </div>
                    <div className="settings-grid settings-grid--compact">
                      <label className="settings-field">
                        <span className="settings-field__label">{`Bridge cols (${MIN_BRIDGE_COLS}-${MAX_BRIDGE_COLS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_BRIDGE_COLS}
                          max={MAX_BRIDGE_COLS}
                          step={1}
                          value={settingsDraft.bridgeCols}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(setSettingsDraft, 'bridgeCols', event.target.value, MIN_BRIDGE_COLS, MAX_BRIDGE_COLS)
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(setSettingsDraft, 'bridgeCols', settingsDraft.bridgeCols, MIN_BRIDGE_COLS, MAX_BRIDGE_COLS)
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Bridge rows (${MIN_BRIDGE_ROWS}-${MAX_BRIDGE_ROWS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_BRIDGE_ROWS}
                          max={MAX_BRIDGE_ROWS}
                          step={1}
                          value={settingsDraft.bridgeRows}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(setSettingsDraft, 'bridgeRows', event.target.value, MIN_BRIDGE_ROWS, MAX_BRIDGE_ROWS)
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(setSettingsDraft, 'bridgeRows', settingsDraft.bridgeRows, MIN_BRIDGE_ROWS, MAX_BRIDGE_ROWS)
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">Artifact publish folder</span>
                        <input
                          className="settings-field__input"
                          type="text"
                          value={settingsDraft.artifactWatchDirectory}
                          onChange={(event) =>
                            setSettingsDraft((current) => ({
                              ...current,
                              artifactWatchDirectory: event.target.value
                            }))
                          }
                          placeholder="C:\\path\\to\\discord-publish"
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">Artifact channel</span>
                        <input
                          className="settings-field__input"
                          type="text"
                          value={bridgeSettings.artifactPublish.channelId || 'Auto-create on Discord connect'}
                          readOnly
                        />
                      </label>
                    </div>
                  </div>

                  <div className="settings-group">
                    <div className="settings-group__header">
                      <h3 className="settings-group__title">Input and redraw timing</h3>
                      <p className="settings-group__description">Adjust waits around redraw, snapshots, text submission, and repeated control-key input.</p>
                    </div>
                    <div className="settings-grid">
                      <label className="settings-field">
                        <span className="settings-field__label">{`Redraw shrink wait (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.redrawWaitAfterShrinkMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(setSettingsDraft, 'redrawWaitAfterShrinkMs', event.target.value, MIN_TIMING_DELAY_MS, MAX_TIMING_DELAY_MS)
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'redrawWaitAfterShrinkMs',
                              settingsDraft.redrawWaitAfterShrinkMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Before-send redraw restore (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.beforeSendRedrawRestoreMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(setSettingsDraft, 'beforeSendRedrawRestoreMs', event.target.value, MIN_TIMING_DELAY_MS, MAX_TIMING_DELAY_MS)
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'beforeSendRedrawRestoreMs',
                              settingsDraft.beforeSendRedrawRestoreMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Before-send post-redraw wait (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.beforeSendPostRedrawDelayMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'beforeSendPostRedrawDelayMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'beforeSendPostRedrawDelayMs',
                              settingsDraft.beforeSendPostRedrawDelayMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Pre-input snapshot wait (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.preTextInputSnapshotDelayMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'preTextInputSnapshotDelayMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'preTextInputSnapshotDelayMs',
                              settingsDraft.preTextInputSnapshotDelayMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Text-to-Enter wait (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.textSubmitEnterDelayMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'textSubmitEnterDelayMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'textSubmitEnterDelayMs',
                              settingsDraft.textSubmitEnterDelayMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Repeat key interval (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.repeatedControlKeyDelayMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'repeatedControlKeyDelayMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'repeatedControlKeyDelayMs',
                              settingsDraft.repeatedControlKeyDelayMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`After-complete redraw restore (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.afterCompleteRedrawRestoreMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'afterCompleteRedrawRestoreMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'afterCompleteRedrawRestoreMs',
                              settingsDraft.afterCompleteRedrawRestoreMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Manual redraw shrink wait (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.manualRedrawWaitAfterShrinkMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'manualRedrawWaitAfterShrinkMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'manualRedrawWaitAfterShrinkMs',
                              settingsDraft.manualRedrawWaitAfterShrinkMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Manual redraw restore wait (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.manualRedrawWaitAfterRestoreMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'manualRedrawWaitAfterRestoreMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'manualRedrawWaitAfterRestoreMs',
                              settingsDraft.manualRedrawWaitAfterRestoreMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                    </div>
                  </div>

                  <div className="settings-group">
                    <div className="settings-group__header">
                      <h3 className="settings-group__title">Completion detection</h3>
                      <p className="settings-group__description">Tune the polling and stabilization rules used to decide when terminal work has finished.</p>
                    </div>
                    <div className="settings-grid settings-grid--compact">
                      <label className="settings-field">
                        <span className="settings-field__label">{`Completion settle (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.completionSettleMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(setSettingsDraft, 'completionSettleMs', event.target.value, MIN_TIMING_DELAY_MS, MAX_TIMING_DELAY_MS)
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'completionSettleMs',
                              settingsDraft.completionSettleMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Completion no-output timeout (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.completionNoOutputTimeoutMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'completionNoOutputTimeoutMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'completionNoOutputTimeoutMs',
                              settingsDraft.completionNoOutputTimeoutMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Completion poll interval (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.completionPollIntervalMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'completionPollIntervalMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'completionPollIntervalMs',
                              settingsDraft.completionPollIntervalMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Completion stable polls (${MIN_TIMING_COUNT}-${MAX_TIMING_COUNT})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_COUNT}
                          max={MAX_TIMING_COUNT}
                          step={1}
                          value={settingsDraft.completionStablePollCount}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(setSettingsDraft, 'completionStablePollCount', event.target.value, MIN_TIMING_COUNT, MAX_TIMING_COUNT)
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'completionStablePollCount',
                              settingsDraft.completionStablePollCount,
                              MIN_TIMING_COUNT,
                              MAX_TIMING_COUNT
                            )
                          }
                        />
                      </label>
                    </div>
                  </div>

                  <div className="settings-group">
                    <div className="settings-group__header">
                      <h3 className="settings-group__title">Live view and capture</h3>
                      <p className="settings-group__description">Configure live snapshot publishing and screenshot capture timings used by the app and bridge.</p>
                    </div>
                    <div className="settings-grid">
                      <label className="settings-field">
                        <span className="settings-field__label">{`Live view publish debounce (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.liveViewSnapshotDebounceMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'liveViewSnapshotDebounceMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'liveViewSnapshotDebounceMs',
                              settingsDraft.liveViewSnapshotDebounceMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Snapshot mirror flush timeout (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.snapshotMirrorFlushTimeoutMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'snapshotMirrorFlushTimeoutMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'snapshotMirrorFlushTimeoutMs',
                              settingsDraft.snapshotMirrorFlushTimeoutMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Window screenshot delay (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.windowScreenshotCaptureDelayMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'windowScreenshotCaptureDelayMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'windowScreenshotCaptureDelayMs',
                              settingsDraft.windowScreenshotCaptureDelayMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Terminal screenshot resize settle (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.terminalScreenshotResizeSettleMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'terminalScreenshotResizeSettleMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'terminalScreenshotResizeSettleMs',
                              settingsDraft.terminalScreenshotResizeSettleMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Terminal screenshot poll interval (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.terminalScreenshotPollIntervalMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'terminalScreenshotPollIntervalMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'terminalScreenshotPollIntervalMs',
                              settingsDraft.terminalScreenshotPollIntervalMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Terminal screenshot ready timeout (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.terminalScreenshotReadyTimeoutMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'terminalScreenshotReadyTimeoutMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'terminalScreenshotReadyTimeoutMs',
                              settingsDraft.terminalScreenshotReadyTimeoutMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                    </div>
                  </div>

                  <div className="settings-group">
                    <div className="settings-group__header">
                      <h3 className="settings-group__title">System operations</h3>
                      <p className="settings-group__description">Adjust the waits used when restarting the app and downloading Discord attachments.</p>
                    </div>
                    <div className="settings-grid settings-grid--compact">
                      <label className="settings-field">
                        <span className="settings-field__label">{`App restart delay (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.appRestartDelayMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(setSettingsDraft, 'appRestartDelayMs', event.target.value, MIN_TIMING_DELAY_MS, MAX_TIMING_DELAY_MS)
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'appRestartDelayMs',
                              settingsDraft.appRestartDelayMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field__label">{`Attachment download timeout (ms, ${MIN_TIMING_DELAY_MS}-${MAX_TIMING_DELAY_MS})`}</span>
                        <input
                          className="settings-field__input"
                          type="number"
                          min={MIN_TIMING_DELAY_MS}
                          max={MAX_TIMING_DELAY_MS}
                          step={1}
                          value={settingsDraft.attachmentDownloadTimeoutMs}
                          onChange={(event) =>
                            updateBoundedIntegerDraft(
                              setSettingsDraft,
                              'attachmentDownloadTimeoutMs',
                              event.target.value,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                          onBlur={() =>
                            clampBoundedIntegerDraft(
                              setSettingsDraft,
                              'attachmentDownloadTimeoutMs',
                              settingsDraft.attachmentDownloadTimeoutMs,
                              MIN_TIMING_DELAY_MS,
                              MAX_TIMING_DELAY_MS
                            )
                          }
                        />
                      </label>
                    </div>
                  </div>

                </div>
              </section>

              <section className="settings-section">
                <h2 className="settings-section__title">Per slot</h2>
                <div className="slot-settings-list">
                  {orderSlotsForLayout(slotDrafts).map((slot) => (
                      <div key={slot.slotId} className="slot-settings-card">
                        <div className="slot-settings-card__title">slot{slot.slotId}</div>
                        <div className="settings-form">
                          <label className="settings-field">
                            <span className="settings-field__label">Workspace</span>
                            <input
                              className="settings-field__input"
                              value={slot.workspaceName}
                              onChange={(event) => updateSlotDraft(setSlotDrafts, slot.slotId, { workspaceName: event.target.value })}
                            />
                          </label>
                          <label className="settings-field">
                            <span className="settings-field__label">Channel ID</span>
                            <input
                              className="settings-field__input"
                              value={slot.channelId}
                              onChange={(event) => updateSlotDraft(setSlotDrafts, slot.slotId, { channelId: event.target.value })}
                            />
                          </label>
                          <label className="settings-field">
                            <span className="settings-field__label">Default cwd</span>
                            <input
                              className="settings-field__input"
                              value={slot.cwd}
                              onChange={(event) => updateSlotDraft(setSlotDrafts, slot.slotId, { cwd: event.target.value })}
                            />
                          </label>
                          <label className="settings-toggle slot-settings-card__toggle">
                            <input
                              type="checkbox"
                              checked={slot.startupCommandEnabled}
                              onChange={(event) =>
                                updateSlotDraft(setSlotDrafts, slot.slotId, {
                                  startupCommandEnabled: event.target.checked
                                })
                              }
                            />
                            <div className="settings-toggle__body">
                              <div className="settings-toggle__title">Startup command</div>
                              <div className="settings-toggle__description">Run once on app startup after this slot reaches its first PowerShell prompt.</div>
                            </div>
                          </label>
                          <label className="settings-field">
                            <span className="settings-field__label">Startup command text</span>
                            <input
                              className="settings-field__input"
                              value={slot.startupCommandText}
                              placeholder="copilotyolo"
                              onChange={(event) => updateSlotDraft(setSlotDrafts, slot.slotId, { startupCommandText: event.target.value })}
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                </div>
              </section>
            </div>

            <footer className="settings-screen__footer">
              {settingsError ? <div className="settings-screen__error">{settingsError}</div> : <div />}
              <div className="settings-screen__actions">
                <button className="action-button" onClick={closeSettings} disabled={isSavingSettings}>
                  Cancel
                </button>
                <button className="action-button" onClick={() => void saveSettings()} disabled={isSavingSettings}>
                  Save settings
                </button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function createSettingsDraft(bridgeSettings: BridgeSettings): SettingsDraft {
  return {
    replyTextOnCompletion: bridgeSettings.replyTextOnCompletion,
    completionReplyMaxChars: String(bridgeSettings.completionReplyMaxChars),
    autoScreenshotOnReply: bridgeSettings.autoScreenshotOnReply,
    inflightScreenshotOnRunningRequest: bridgeSettings.inflightScreenshotOnRunningRequest,
    replyFormat: bridgeSettings.replyFormat,
    softTimeoutSeconds: String(Math.round(bridgeSettings.softTimeoutMs / 1000)),
    hardTimeoutSeconds:
      bridgeSettings.hardTimeoutMs === null ? String(DEFAULT_HARD_TIMEOUT_SECONDS) : String(Math.round(bridgeSettings.hardTimeoutMs / 1000)),
    hardTimeoutUnlimited: bridgeSettings.hardTimeoutMs === null,
    artifactWatchDirectory: bridgeSettings.artifactPublish.watchDirectory,
    diffAnchorChars: String(bridgeSettings.diffAnchorChars),
    bridgeCols: String(bridgeSettings.bridgeDimensions.cols),
    bridgeRows: String(bridgeSettings.bridgeDimensions.rows),
    inflightScreenshotDelaySeconds: String(Math.round(bridgeSettings.timing.inflightScreenshotDelayMs / 1000)),
    redrawWaitAfterShrinkMs: String(bridgeSettings.timing.redrawWaitAfterShrinkMs),
    beforeSendRedrawRestoreMs: String(bridgeSettings.timing.beforeSendRedrawRestoreMs),
    afterCompleteRedrawRestoreMs: String(bridgeSettings.timing.afterCompleteRedrawRestoreMs),
    beforeSendPostRedrawDelayMs: String(bridgeSettings.timing.beforeSendPostRedrawDelayMs),
    preTextInputSnapshotDelayMs: String(bridgeSettings.timing.preTextInputSnapshotDelayMs),
    textSubmitEnterDelayMs: String(bridgeSettings.timing.textSubmitEnterDelayMs),
    repeatedControlKeyDelayMs: String(bridgeSettings.timing.repeatedControlKeyDelayMs),
    completionSettleMs: String(bridgeSettings.timing.completionSettleMs),
    completionNoOutputTimeoutMs: String(bridgeSettings.timing.completionNoOutputTimeoutMs),
    completionPollIntervalMs: String(bridgeSettings.timing.completionPollIntervalMs),
    completionStablePollCount: String(bridgeSettings.timing.completionStablePollCount),
    manualRedrawWaitAfterShrinkMs: String(bridgeSettings.timing.manualRedrawWaitAfterShrinkMs),
    manualRedrawWaitAfterRestoreMs: String(bridgeSettings.timing.manualRedrawWaitAfterRestoreMs),
    liveViewSnapshotDebounceMs: String(bridgeSettings.timing.liveViewSnapshotDebounceMs),
    snapshotMirrorFlushTimeoutMs: String(bridgeSettings.timing.snapshotMirrorFlushTimeoutMs),
    windowScreenshotCaptureDelayMs: String(bridgeSettings.timing.windowScreenshotCaptureDelayMs),
    terminalScreenshotResizeSettleMs: String(bridgeSettings.timing.terminalScreenshotResizeSettleMs),
    terminalScreenshotPollIntervalMs: String(bridgeSettings.timing.terminalScreenshotPollIntervalMs),
    terminalScreenshotReadyTimeoutMs: String(bridgeSettings.timing.terminalScreenshotReadyTimeoutMs),
    appRestartDelayMs: String(bridgeSettings.timing.appRestartDelayMs),
    attachmentDownloadTimeoutMs: String(bridgeSettings.timing.attachmentDownloadTimeoutMs)
  };
}

function updateBoundedIntegerDraft(
  setSettingsDraft: Dispatch<SetStateAction<SettingsDraft>>,
  key: SettingsNumericField,
  nextValue: string,
  min: number,
  max: number
) {
  const normalized = nextValue.trim();
  if (normalized === '') {
    setSettingsDraft((current) => ({
      ...current,
      [key]: normalized
    }));
    return;
  }

  if (!/^\d+$/.test(normalized) || !isNumericPrefixWithinRange(normalized, min, max)) {
    return;
  }

  setSettingsDraft((current) => ({
    ...current,
    [key]: normalized
  }));
}

function clampBoundedIntegerDraft(
  setSettingsDraft: Dispatch<SetStateAction<SettingsDraft>>,
  key: SettingsNumericField,
  currentValue: string,
  min: number,
  max: number
) {
  const clamped = clampBoundedInteger(currentValue, min, max);
  setSettingsDraft((current) => ({
    ...current,
    [key]: String(clamped)
  }));
}

function parseBoundedInteger(value: string, min: number, max: number): number {
  if (!/^\d+$/.test(value.trim())) {
    return Number.NaN;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return Number.NaN;
  }

  return parsed;
}

function clampBoundedInteger(value: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function isNumericPrefixWithinRange(value: string, min: number, max: number): boolean {
  for (let candidate = min; candidate <= max; candidate += 1) {
    const candidateText = String(candidate);
    if (candidateText.startsWith(value)) {
      return true;
    }
  }

  return false;
}

function upsertSession(current: TerminalSessionSummary[], next: TerminalSessionSummary): TerminalSessionSummary[] {
  const existingById = current.findIndex((session) => session.id === next.id);
  if (existingById !== -1) {
    const updated = [...current];
    updated[existingById] = next;
    return updated;
  }

  if (next.slotId) {
    const existingBySlot = current.findIndex((session) => session.slotId === next.slotId);
    if (existingBySlot !== -1) {
      const existing = current[existingBySlot];
      if (existing.id !== next.id && existing.status !== 'exited' && next.status === 'exited') {
        return current;
      }

      const updated = [...current];
      updated[existingBySlot] = next;
      return updated;
    }
  }

  return [...current, next];
}

function getPaneStatus(session: TerminalSessionSummary | null): { label: string; className: string } {
  if (!session) {
    return {
      label: 'OFF',
      className: 'terminal-tile__status terminal-tile__status--exit'
    };
  }

  if (session.status === 'exited') {
    return {
      label: 'EXIT',
      className: 'terminal-tile__status terminal-tile__status--exit'
    };
  }

  if (session.inputLocked) {
    return {
      label: 'BUSY',
      className: 'terminal-tile__status terminal-tile__status--busy'
    };
  }

  return {
    label: 'LIVE',
    className: 'terminal-tile__status terminal-tile__status--live'
  };
}

function appendAppLogEntry(current: AppLogEntry[], entry: AppLogEntry): AppLogEntry[] {
  if (current.length >= MAX_RENDERED_APP_LOGS) {
    return [...current.slice(current.length - MAX_RENDERED_APP_LOGS + 1), entry];
  }

  return [...current, entry];
}

function orderSlotsForLayout(slots: TerminalSlotSettings[]): TerminalSlotSettings[] {
  const orderMap = new Map(SLOT_LAYOUT_ORDER.map((slotId, index) => [slotId, index]));
  return [...slots].sort((left, right) => {
    const leftOrder = orderMap.get(left.slotId) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = orderMap.get(right.slotId) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.slotId - right.slotId;
  });
}

function updateSlotDraft(
  setSlotDrafts: Dispatch<SetStateAction<TerminalSlotSettings[]>>,
  slotId: TerminalSlotId,
  update: Partial<TerminalSlotSettings>
) {
  setSlotDrafts((current) => current.map((slot) => (slot.slotId === slotId ? { ...slot, ...update } : slot)));
}

function hasLineBreak(value: string): boolean {
  return /[\r\n]/.test(value);
}

function findSlotName(slots: TerminalSlotSettings[], slotId: TerminalSlotId | undefined): string {
  if (!slotId) {
    return 'slot';
  }

  return slots.find((slot) => slot.slotId === slotId)?.workspaceName ?? `slot${slotId}`;
}

function getWorkspaceGridPosition(index: number) {
  const columnIndex = index % WORKSPACE_COLUMN_GRID_COLUMNS.length;
  const rowIndex = Math.floor(index / WORKSPACE_COLUMN_GRID_COLUMNS.length);
  return {
    gridColumn: WORKSPACE_COLUMN_GRID_COLUMNS[columnIndex],
    gridRow: rowIndex === 0 ? '1' : '3'
  };
}

function createWorkspaceGridStyle(layout: WorkspacePaneLayout) {
  const gridTemplateColumns: string[] = [];
  layout.columnFractions.forEach((fraction, index) => {
    gridTemplateColumns.push(`minmax(0, ${fraction}fr)`);
    if (index < layout.columnFractions.length - 1) {
      gridTemplateColumns.push(`${WORKSPACE_DIVIDER_SIZE_PX}px`);
    }
  });

  return {
    gridTemplateColumns: gridTemplateColumns.join(' '),
    gridTemplateRows: [`minmax(0, ${layout.rowFractions[0]}fr)`, `${WORKSPACE_DIVIDER_SIZE_PX}px`, `minmax(0, ${layout.rowFractions[1]}fr)`].join(' ')
  };
}

function calculateWorkspacePaneLayout(
  divider: WorkspaceDivider,
  layout: WorkspacePaneLayout,
  container: HTMLElement | null,
  clientX: number,
  clientY: number
): WorkspacePaneLayout {
  if (!container) {
    return layout;
  }

  const rect = container.getBoundingClientRect();
  const innerWidth = rect.width - WORKSPACE_PADDING_PX * 2;
  const innerHeight = rect.height - WORKSPACE_PADDING_PX * 2;
  const usableWidth = innerWidth - WORKSPACE_DIVIDER_SIZE_PX * (layout.columnFractions.length - 1);
  const usableHeight = innerHeight - WORKSPACE_DIVIDER_SIZE_PX;
  if (usableWidth <= 0 || usableHeight <= 0) {
    return layout;
  }

  const columnWidths = fractionsToPixels(layout.columnFractions, usableWidth);
  const rowHeights = fractionsToPixels(layout.rowFractions, usableHeight);
  const relativeX = clampNumber(clientX - rect.left - WORKSPACE_PADDING_PX, 0, innerWidth);
  const relativeY = clampNumber(clientY - rect.top - WORKSPACE_PADDING_PX, 0, innerHeight);

  if (divider !== 'horizontal') {
    const dividerIndex = WORKSPACE_VERTICAL_DIVIDERS.findIndex((entry) => entry.id === divider);
    if (dividerIndex !== -1) {
      const precedingWidth = columnWidths.slice(0, dividerIndex).reduce((sum, value) => sum + value, 0);
      const pairWidth = columnWidths[dividerIndex] + columnWidths[dividerIndex + 1];
      const boundary = clampNumber(relativeX - WORKSPACE_DIVIDER_SIZE_PX * (dividerIndex + 0.5), 0, usableWidth);
      const nextBoundary = clampNumber(
        boundary,
        precedingWidth + MIN_WORKSPACE_COLUMN_SIZE_PX,
        precedingWidth + pairWidth - MIN_WORKSPACE_COLUMN_SIZE_PX
      );
      const nextColumnWidths = [...columnWidths];
      nextColumnWidths[dividerIndex] = nextBoundary - precedingWidth;
      nextColumnWidths[dividerIndex + 1] = precedingWidth + pairWidth - nextBoundary;
      return {
        columnFractions: normalizePixels(nextColumnWidths) as WorkspacePaneLayout['columnFractions'],
        rowFractions: layout.rowFractions
      };
    }
  }

  if (divider !== 'horizontal') {
    return layout;
  }

  const topBoundary = clampNumber(relativeY - WORKSPACE_DIVIDER_SIZE_PX / 2, 0, usableHeight);
  const nextTopHeight = clampNumber(topBoundary, MIN_WORKSPACE_ROW_SIZE_PX, usableHeight - MIN_WORKSPACE_ROW_SIZE_PX);
  return {
    columnFractions: layout.columnFractions,
    rowFractions: normalizePixels([nextTopHeight, usableHeight - nextTopHeight]) as [number, number]
  };
}

function fractionsToPixels(fractions: readonly number[], total: number): number[] {
  return fractions.map((fraction) => fraction * total);
}

function normalizePixels(pixels: number[]): number[] {
  const total = pixels.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return pixels.map(() => 1 / pixels.length);
  }

  return pixels.map((value) => value / total);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function areWorkspacePaneLayoutsEqual(left: WorkspacePaneLayout, right: WorkspacePaneLayout): boolean {
  return areFractionVectorsEqual(left.columnFractions, right.columnFractions) && areFractionVectorsEqual(left.rowFractions, right.rowFractions);
}

function areFractionVectorsEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => Math.abs(value - right[index]) < 0.0001);
}
