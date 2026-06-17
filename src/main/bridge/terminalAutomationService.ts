import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  TerminalAutomationTurnRequest,
  TerminalAutomationTurnResult,
  TerminalControlKey,
  TerminalSendInputRequest,
  TerminalSessionSnapshot,
  TerminalWaitForCompletionRequest,
  TerminalWaitForCompletionResult,
  TerminalWriteSource
} from '../../shared/terminal';
import { PreferencesStore } from '../app/preferencesStore';
import { TerminalSessionManager } from '../terminal/terminalSessionManager';
import type { BridgeRuntimeConfig } from './bridgeConfig';
import { DiscordReplyFormatter } from './discordReplyFormatter';
import { extractComparableLineDiff, isComparableCharacter, normalizeTerminalText } from './replyTextDiff';
import { TerminalDiffService } from './terminalDiffService';

export class TerminalAutomationService {
  private readonly diffService = new TerminalDiffService();
  private readonly replyFormatter: DiscordReplyFormatter;
  private readonly abortRequestedSessions = new Set<string>();

  constructor(
    private readonly terminalSessionManager: TerminalSessionManager,
    private readonly config: BridgeRuntimeConfig,
    private readonly preferencesStore: PreferencesStore
  ) {
    this.replyFormatter = new DiscordReplyFormatter(config.reply);
  }

  async sendInput(request: TerminalSendInputRequest): Promise<void> {
    const source = request.source ?? 'bridge';
    const timing = this.preferencesStore.getBridgeSettings().timing;
    if (request.content) {
      this.terminalSessionManager.write({
        sessionId: request.sessionId,
        data: request.content,
        source
      });
    }

    if (request.appendEnter ?? true) {
      if (request.content) {
        await wait(timing.textSubmitEnterDelayMs);
      }

      this.terminalSessionManager.sendKey(request.sessionId, 'enter', source);
    }
  }

  async waitForCompletion(request: TerminalWaitForCompletionRequest): Promise<TerminalWaitForCompletionResult> {
    const startedAt = Date.now();
    const expectOutput = request.expectOutput ?? true;
    const promoteToOutputOnMeaningfulChange = request.promoteToOutputOnMeaningfulChange ?? false;
    const bridgeSettings = this.preferencesStore.getBridgeSettings();
    const { timing } = bridgeSettings;
    const stablePollTarget = request.stablePollCount ?? timing.completionStablePollCount;
    const settleMs = request.settleMs ?? timing.completionSettleMs;
    const softTimeoutMs = request.softTimeoutMs ?? bridgeSettings.softTimeoutMs;
    const noOutputTimeoutMs = request.noOutputTimeoutMs ?? timing.completionNoOutputTimeoutMs;
    const hardTimeoutMs = request.hardTimeoutMs ?? bridgeSettings.hardTimeoutMs;
    const pollIntervalMs = request.pollIntervalMs ?? timing.completionPollIntervalMs;
    const baselinePromptReadyAt = request.baselinePromptReadyAt;
    const baselineObservedOutputEvents = request.baselineObservedOutputEvents ?? 0;

    let stablePollCount = 0;
    let previousHash: string | undefined;
    let promotedToOutputWait = false;

    while (true) {
      const state = await this.terminalSessionManager.getSessionState(request.sessionId);
      const snapshot = await this.terminalSessionManager.getBufferSnapshot(request.sessionId, 'manual');
      const now = Date.now();
      const elapsed = now - startedAt;
      const idleMs = state.lastActivityAt ? Math.max(0, now - Date.parse(state.lastActivityAt)) : Number.POSITIVE_INFINITY;
      const observedOutput = state.observedOutputEvents > baselineObservedOutputEvents;
      const hasPromptReady = isAfter(state.lastPromptReadyAt, baselinePromptReadyAt);
      const abortRequested = this.abortRequestedSessions.has(request.sessionId);

      if (snapshot.hash === previousHash) {
        stablePollCount += 1;
      } else {
        previousHash = snapshot.hash;
        stablePollCount = 1;
      }

      const isStable = stablePollCount >= stablePollTarget;
      const hasStableObservedOutput = isStable && idleMs >= settleMs && observedOutput;
      const hasMeaningfulVisibleChange = hasMeaningfulReplyText({
        beforeText: request.beforeScreenText,
        afterText: snapshot.screenText,
        submittedText: request.submittedText,
        diffAnchorChars: bridgeSettings.diffAnchorChars
      });
      const hasMeaningfulChangeSignal = observedOutput || hasMeaningfulVisibleChange;
      if (state.status === 'exited') {
        if (abortRequested) {
          return buildCompletionResult(request.sessionId, 'aborted', true, snapshot, state);
        }

        return buildCompletionResult(request.sessionId, 'hard_timeout_failed', false, snapshot, state);
      }

      if (abortRequested) {
        if (hasPromptReady && isStable) {
          return buildCompletionResult(request.sessionId, 'aborted', true, snapshot, state);
        }

        if (elapsed >= noOutputTimeoutMs && (hasPromptReady || isStable)) {
          return buildCompletionResult(request.sessionId, 'aborted', true, snapshot, state);
        }
      }

      if (!expectOutput && promoteToOutputOnMeaningfulChange && hasMeaningfulChangeSignal) {
        promotedToOutputWait = true;
      }

      if (!expectOutput && !promotedToOutputWait) {
        if (hasPromptReady && isStable) {
          return buildCompletionResult(request.sessionId, 'prompt_ready', true, snapshot, state);
        }

        if (elapsed >= noOutputTimeoutMs && (hasPromptReady || isStable)) {
          return buildCompletionResult(request.sessionId, 'no_output_timeout', true, snapshot, state);
        }
      } else if (expectOutput) {
        if (hasPromptReady && isStable && idleMs >= settleMs && observedOutput) {
          return buildCompletionResult(request.sessionId, 'prompt_ready', true, snapshot, state);
        }

        if (elapsed >= noOutputTimeoutMs && hasStableObservedOutput && hasMeaningfulVisibleChange) {
          return buildCompletionResult(request.sessionId, 'idle_stable', true, snapshot, state);
        }

        if (elapsed >= softTimeoutMs && hasStableObservedOutput && hasMeaningfulVisibleChange) {
          return buildCompletionResult(request.sessionId, 'soft_timeout_stable', true, snapshot, state);
        }

        if (elapsed >= softTimeoutMs && isStable && idleMs >= settleMs && !observedOutput) {
          return buildCompletionResult(request.sessionId, 'no_output_timeout', false, snapshot, state);
        }
      } else {
        if (elapsed >= noOutputTimeoutMs && isStable && idleMs >= settleMs && hasMeaningfulChangeSignal) {
          return buildCompletionResult(request.sessionId, 'idle_stable', true, snapshot, state);
        }

        if (elapsed >= softTimeoutMs && isStable && idleMs >= settleMs && hasMeaningfulChangeSignal) {
          return buildCompletionResult(request.sessionId, 'soft_timeout_stable', true, snapshot, state);
        }

        if (elapsed >= softTimeoutMs && isStable && idleMs >= settleMs && !hasMeaningfulChangeSignal) {
          return buildCompletionResult(request.sessionId, 'no_output_timeout', false, snapshot, state);
        }
      }

      if (hardTimeoutMs !== null && elapsed >= hardTimeoutMs) {
        return buildCompletionResult(request.sessionId, 'hard_timeout_failed', false, snapshot, state);
      }

      await wait(pollIntervalMs);
    }
  }

  async runAutomationTurn(request: TerminalAutomationTurnRequest): Promise<TerminalAutomationTurnResult> {
    this.clearAbort(request.sessionId);
    const beforeSnapshot = request.captureBefore === false ? undefined : await this.captureSnapshot(request.sessionId, 'before-send', true);
    const baselineState = await this.terminalSessionManager.getSessionState(request.sessionId);
    const beforeRawTranscript = await this.terminalSessionManager.getRawTranscriptSince(request.sessionId, 0);
    const baselineRawOffset = beforeRawTranscript.length;
    const bridgeSettings = this.preferencesStore.getBridgeSettings();
    const { timing } = bridgeSettings;

    if (request.kind === 'text') {
      if (beforeSnapshot) {
        await wait(timing.preTextInputSnapshotDelayMs);
      }

      await this.sendInput({
        sessionId: request.sessionId,
        content: request.content ?? '',
        appendEnter: request.appendEnter ?? true,
        source: 'bridge'
      });
    } else {
      const key = request.key ?? 'enter';
      await this.sendControlKey(
        request.sessionId,
        key,
        request.repeatCount ?? 1,
        request.repeatDelayMs ?? timing.repeatedControlKeyDelayMs,
        'bridge'
      );
    }

    const completion = await this.waitForCompletion({
      sessionId: request.sessionId,
      expectOutput: request.expectOutput ?? request.kind === 'text',
      promoteToOutputOnMeaningfulChange:
        request.kind === 'control' && (request.key ?? 'enter') === 'enter' && !(request.expectOutput ?? false),
      beforeScreenText: beforeSnapshot?.screenText,
      submittedText: request.kind === 'text' ? request.content : undefined,
      baselinePromptReadyAt: baselineState.lastPromptReadyAt,
      baselineRawOutputOffset: baselineRawOffset,
      baselineObservedOutputEvents: baselineState.observedOutputEvents
    });

    const afterSnapshot = request.captureAfter === false ? undefined : await this.captureSnapshot(request.sessionId, 'after-complete', true);
    const afterRawTranscript = await this.terminalSessionManager.getRawTranscriptSince(request.sessionId, 0);
    const rawOutput = afterRawTranscript.slice(baselineRawOffset);
    const diffAfterSnapshot = afterSnapshot ?? (await this.captureSnapshot(request.sessionId, 'manual', false));
    const diff = this.diffService.buildDiff({
      beforeSnapshot,
      afterSnapshot: diffAfterSnapshot,
      rawOutput,
      tailChars: this.config.diff.tailChars,
      fallbackLines: this.config.diff.fallbackLines,
      middleAnchorChars: bridgeSettings.diffAnchorChars
    });
    const replyResult = sanitizeReplyText({
      beforeText: beforeSnapshot?.screenText,
      afterText: diffAfterSnapshot.screenText,
      fallbackText: diff.diffText,
      submittedText: request.kind === 'text' ? request.content : undefined,
      diffAnchorChars: bridgeSettings.diffAnchorChars,
      maxChars: bridgeSettings.completionReplyMaxChars
    });
    const replyText = replyResult.usedFallback
      ? `[reply fallback used]\n${replyResult.text}`
      : replyResult.text;
    const replyChunks = this.replyFormatter.format(replyText, bridgeSettings.replyFormat);

    return {
      beforeSnapshot,
      afterSnapshot,
      rawOutput,
      diff,
      replyChunks,
      completion
    };
  }

  async captureSnapshot(
    sessionId: string,
    reason: TerminalSessionSnapshot['reason'],
    redraw: boolean
  ): Promise<TerminalSessionSnapshot> {
    if (redraw) {
      const timing = this.preferencesStore.getBridgeSettings().timing;
      await this.terminalSessionManager.redrawJiggle({
        sessionId,
        shrinkCols: 1,
        waitAfterShrinkMs: timing.redrawWaitAfterShrinkMs,
        waitAfterRestoreMs: reason === 'before-send' ? timing.beforeSendRedrawRestoreMs : timing.afterCompleteRedrawRestoreMs
      });
      if (reason === 'before-send') {
        await wait(timing.beforeSendPostRedrawDelayMs);
      }
    }

    const snapshot = await this.terminalSessionManager.getBufferSnapshot(sessionId, reason);
    this.persistSnapshot(snapshot);
    return snapshot;
  }

  softStop(sessionId: string): void {
    this.requestAbort(sessionId);
  }

  requestAbort(sessionId: string): void {
    this.abortRequestedSessions.add(sessionId);
    this.terminalSessionManager.stopRequest(sessionId);
  }

  clearAbort(sessionId: string): void {
    this.abortRequestedSessions.delete(sessionId);
  }

  async sendControlKey(
    sessionId: string,
    key: TerminalControlKey,
    repeatCount = 1,
    repeatDelayMs?: number,
    source: TerminalWriteSource = 'bridge'
  ): Promise<void> {
    const safeRepeatCount = Math.max(1, Math.trunc(repeatCount));
    const safeRepeatDelayMs = Math.max(
      0,
      Math.trunc(repeatDelayMs ?? this.preferencesStore.getBridgeSettings().timing.repeatedControlKeyDelayMs)
    );
    for (let index = 0; index < safeRepeatCount; index += 1) {
      this.terminalSessionManager.sendKey(sessionId, key, source);
      if (index + 1 < safeRepeatCount) {
        await wait(safeRepeatDelayMs);
      }
    }
  }

  setInputLock(sessionId: string, locked: boolean) {
    return this.terminalSessionManager.setInputLock({
      sessionId,
      locked
    });
  }

  private persistSnapshot(snapshot: TerminalSessionSnapshot): void {
    mkdirSync(this.config.storage.snapshotDirectory, { recursive: true });
    const filename = `${snapshot.sessionId}-${snapshot.capturedAt.replace(/[:.]/g, '-')}-${snapshot.reason}.json`;
    const filePath = path.join(this.config.storage.snapshotDirectory, filename);
    writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
  }
}

function buildCompletionResult(
  sessionId: string,
  reason: TerminalWaitForCompletionResult['reason'],
  success: boolean,
  snapshot: TerminalSessionSnapshot,
  state: Awaited<ReturnType<TerminalSessionManager['getSessionState']>>
): TerminalWaitForCompletionResult {
  return {
    sessionId,
    success,
    reason,
    completedAt: new Date().toISOString(),
    screenRevision: snapshot.screenRevision,
    snapshotHash: snapshot.hash,
    observedOutputEvents: state.observedOutputEvents,
    rawTranscriptLength: state.rawTranscriptLength,
    lastActivityAt: state.lastActivityAt,
    lastPromptReadyAt: state.lastPromptReadyAt
  };
}

function isAfter(candidate?: string, baseline?: string): boolean {
  if (!candidate) {
    return false;
  }

  if (!baseline) {
    return true;
  }

  return Date.parse(candidate) > Date.parse(baseline);
}

function normalizeComparisonText(value?: string): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function sanitizeReplyText(options: {
  beforeText?: string;
  afterText?: string;
  fallbackText: string;
  submittedText?: string;
  diffAnchorChars: number;
  maxChars: number;
}): { text: string; usedFallback: boolean } {
  const extracted = extractSanitizedReplyText(options);
  if (extracted) {
    return {
      text: limitReplyText(compressDecorativeRuns(extracted), options.maxChars),
      usedFallback: false
    };
  }

  const fallbackText = normalizeTerminalText(options.fallbackText).trim() || '(no diff)';
  return {
    text: limitReplyText(compressDecorativeRuns(fallbackText), options.maxChars),
    usedFallback: true
  };
}

function hasMeaningfulReplyText(options: {
  beforeText?: string;
  afterText?: string;
  submittedText?: string;
  diffAnchorChars: number;
}): boolean {
  return extractSanitizedReplyText({
    beforeText: options.beforeText,
    afterText: options.afterText,
    fallbackText: '',
    submittedText: options.submittedText,
    diffAnchorChars: options.diffAnchorChars
  }).length > 0;
}

function extractSanitizedReplyText(options: {
  beforeText?: string;
  afterText?: string;
  fallbackText: string;
  submittedText?: string;
  diffAnchorChars: number;
}): string {
  const original = normalizeTerminalText(
    extractTailDiffFromText(options.beforeText, options.afterText, options.diffAnchorChars) ?? options.fallbackText
  );
  const lines = original.split('\n').map((line) => line.replace(/[ \t]+$/g, ''));
  const normalizedSubmitted = normalizeComparisonText(options.submittedText);
  const submittedLines = splitSubmittedLines(options.submittedText);
  const sanitizedLines = [...lines];
  let submittedLineIndex = 0;

  while (sanitizedLines.length > 0 && !sanitizedLines[0]?.trim()) {
    sanitizedLines.shift();
  }

  while (sanitizedLines.length > 0) {
    const first = sanitizedLines[0] ?? '';
    const withoutPrompt = stripPowerShellPrompt(first);
    if (isPowerShellPromptOnlyLine(first)) {
      sanitizedLines.shift();
      continue;
    }

    const normalizedFirst = normalizeComparisonText(withoutPrompt || first);
    if (submittedLineIndex < submittedLines.length && normalizedFirst === submittedLines[submittedLineIndex]) {
      sanitizedLines.shift();
      submittedLineIndex += 1;
      continue;
    }

    if (normalizedSubmitted && normalizedFirst === normalizedSubmitted) {
      sanitizedLines.shift();
      continue;
    }

    break;
  }

  while (sanitizedLines.length > 0) {
    const last = sanitizedLines[sanitizedLines.length - 1] ?? '';
    if (!last.trim() || isPowerShellPromptOnlyLine(last)) {
      sanitizedLines.pop();
      continue;
    }

    break;
  }

  const withoutPromptLines = sanitizedLines.filter((line) => !isPowerShellPromptOnlyLine(line)).join('\n').trim();
  const inlinePromptStripped = stripInlinePowerShellPrompts(withoutPromptLines);
  const withoutEchoLines = inlinePromptStripped
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => {
      if (!line.trim()) {
        return false;
      }

      return !normalizedSubmitted || normalizeComparisonText(line) !== normalizedSubmitted;
    })
    .join('\n')
    .trim();

  return withoutEchoLines;
}

function splitSubmittedLines(value?: string): string[] {
  return normalizeTerminalText(value ?? '')
    .split('\n')
    .map((line) => normalizeComparisonText(stripPowerShellPrompt(line) || line))
    .filter(Boolean);
}

function stripPowerShellPrompt(line: string): string {
  return line.replace(/^PS [^\r\n>]+>\s*/, '');
}

function isPowerShellPromptOnlyLine(line: string): boolean {
  return /^PS [^\r\n>]+>\s*$/.test(line.trim());
}

function stripInlinePowerShellPrompts(text: string): string {
  return text.replace(/PS [^\r\n>]+>\s*/g, '');
}

function extractTailDiffFromText(beforeText: string | undefined, afterText: string | undefined, diffAnchorChars: number): string | undefined {
  return extractComparableLineDiff(beforeText, afterText, REPLY_COMPARISON_TAIL_CHARS, diffAnchorChars);
}

function limitReplyText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  return text.slice(Math.max(0, text.length - maxChars)).trimStart();
}

function compressDecorativeRuns(text: string): string {
  let result = '';
  let previousCharacter: string | undefined;
  let repeatCount = 0;

  for (const character of text) {
    if (character === previousCharacter) {
      repeatCount += 1;
    } else {
      previousCharacter = character;
      repeatCount = 1;
    }

    if (!shouldCompressRepeatedCharacter(character) || repeatCount <= getMaxRepeatedCharacterCount(character)) {
      result += character;
    }
  }

  return result;
}

function shouldCompressRepeatedCharacter(character: string): boolean {
  return !isComparableCharacter(character);
}

function getMaxRepeatedCharacterCount(character: string): number {
  if (character === '\n') {
    return 2;
  }

  return 5;
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
const REPLY_COMPARISON_TAIL_CHARS = 20000;
