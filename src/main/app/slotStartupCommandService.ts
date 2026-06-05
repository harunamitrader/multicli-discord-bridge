import type { BrowserWindow } from 'electron';
import type { TerminalSessionSummary } from '../../shared/terminal';
import { TerminalAutomationService } from '../bridge/terminalAutomationService';
import { TerminalSessionManager } from '../terminal/terminalSessionManager';
import { AppLogStore } from './appLogStore';
import { ensureMainWindowReadyForTerminalInput } from './ensureMainWindowReadyForTerminalInput';
import { TerminalSlotService } from './terminalSlotService';

export class SlotStartupCommandService {
  private readonly pendingSessionIds = new Set<string>();
  private readonly activeSessionIds = new Set<string>();

  constructor(
    private readonly terminalSlotService: TerminalSlotService,
    private readonly terminalSessionManager: TerminalSessionManager,
    private readonly terminalAutomationService: TerminalAutomationService,
    private readonly getMainWindow: () => BrowserWindow | undefined,
    private readonly appLogStore?: AppLogStore
  ) {}

  registerStartupSessions(sessions: TerminalSessionSummary[]): void {
    for (const session of sessions) {
      if (!session.slotId) {
        continue;
      }

      this.pendingSessionIds.add(session.id);
      void this.tryRunForSession(session.id);
    }
  }

  handlePromptReady(sessionId: string): void {
    void this.tryRunForSession(sessionId);
  }

  discardSession(sessionId: string): void {
    this.pendingSessionIds.delete(sessionId);
    this.activeSessionIds.delete(sessionId);
  }

  private async tryRunForSession(sessionId: string): Promise<void> {
    if (!this.pendingSessionIds.has(sessionId) || this.activeSessionIds.has(sessionId) || !this.terminalSessionManager.hasSession(sessionId)) {
      return;
    }

    this.activeSessionIds.add(sessionId);
    try {
      const state = await this.terminalSessionManager.getSessionState(sessionId);
      if (!state.lastPromptReadyAt) {
        return;
      }

      this.pendingSessionIds.delete(sessionId);
      await this.runStartupCommand(sessionId);
    } catch (error) {
      this.pendingSessionIds.delete(sessionId);
      this.log('stderr', `[startup command] failed session=${sessionId} error=${formatError(error)}\n`);
    } finally {
      this.activeSessionIds.delete(sessionId);
    }
  }

  private async runStartupCommand(sessionId: string): Promise<void> {
    const slotId = this.terminalSlotService.getSlotIdBySessionId(sessionId);
    if (!slotId) {
      this.log('stdout', `[startup command] skipped session=${sessionId} reason=unknown-slot\n`);
      return;
    }

    const slot = this.terminalSlotService.getSlot(slotId);
    if (!slot.startupCommandEnabled) {
      this.log('stdout', `[startup command] skipped slot=${slotId} reason=disabled\n`);
      return;
    }

    if (hasLineBreak(slot.startupCommandText)) {
      this.log('stderr', `[startup command] skipped slot=${slotId} reason=multiline\n`);
      return;
    }

    const text = slot.startupCommandText.trim();
    if (text.length === 0) {
      this.log('stdout', `[startup command] skipped slot=${slotId} reason=empty-text\n`);
      return;
    }

    this.log('stdout', `[startup command] sending slot=${slotId} text=${JSON.stringify(text)}\n`);
    await ensureMainWindowReadyForTerminalInput(this.getMainWindow());
    await this.terminalAutomationService.sendInput({
      sessionId,
      content: text,
      appendEnter: true,
      source: 'system'
    });
    this.log('stdout', `[startup command] sent slot=${slotId} text=${JSON.stringify(text)}\n`);
  }

  private log(stream: 'stdout' | 'stderr', message: string): void {
    this.appLogStore?.appendMessage(stream, message);
  }
}

function hasLineBreak(value: string): boolean {
  return /[\r\n]/.test(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
