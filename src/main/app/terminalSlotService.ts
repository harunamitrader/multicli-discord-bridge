import type {
  TerminalSessionSummary,
  TerminalSlotId,
  TerminalSlotSettings,
  TerminalSlotSettingsUpdate
} from '../../shared/terminal';
import { TerminalSessionManager } from '../terminal/terminalSessionManager';
import { PreferencesStore } from './preferencesStore';

export class TerminalSlotService {
  private readonly sessionIds = new Map<TerminalSlotId, string>();

  constructor(
    private readonly preferencesStore: PreferencesStore,
    private readonly terminalSessionManager: TerminalSessionManager
  ) {}

  listSlots(): TerminalSlotSettings[] {
    return this.preferencesStore.getTerminalSlots();
  }

  getSlot(slotId: TerminalSlotId): TerminalSlotSettings {
    const slot = this.listSlots().find((entry) => entry.slotId === slotId);
    if (!slot) {
      throw new Error(`Unknown terminal slot: ${slotId}`);
    }

    return slot;
  }

  findSlotByChannelId(channelId: string): TerminalSlotSettings | undefined {
    return this.listSlots().find((slot) => slot.channelId === channelId);
  }

  updateSlot(update: TerminalSlotSettingsUpdate): { slot: TerminalSlotSettings; session?: TerminalSessionSummary } {
    const slot = this.preferencesStore.updateTerminalSlot(update.slotId, {
      workspaceName: update.workspaceName,
      channelId: update.channelId,
      cwd: update.cwd,
      startupCommandEnabled: update.startupCommandEnabled,
      startupCommandText: update.startupCommandText
    });

    const sessionId = this.sessionIds.get(update.slotId);
    if (!sessionId || !this.terminalSessionManager.hasSession(sessionId)) {
      this.sessionIds.delete(update.slotId);
      return { slot };
    }

    let session: TerminalSessionSummary | undefined;
    if (update.workspaceName !== undefined) {
      session = this.terminalSessionManager.renameSession(sessionId, slot.workspaceName);
    }

    return { slot, session };
  }

  ensureSessions(): TerminalSessionSummary[] {
    return this.listSlots().map((slot) => this.ensureSession(slot.slotId));
  }

  ensureSession(slotId: TerminalSlotId): TerminalSessionSummary {
    const existingSessionId = this.sessionIds.get(slotId);
    if (existingSessionId && this.terminalSessionManager.hasSession(existingSessionId)) {
      const session = this.terminalSessionManager.listSessions().find((entry) => entry.id === existingSessionId);
      if (session) {
        return session;
      }
    }

    const slot = this.getSlot(slotId);
    const session = this.terminalSessionManager.createSession({
      slotId,
      title: slot.workspaceName,
      cwd: slot.cwd,
      mode: 'bridge',
      dimensions: this.terminalSessionManager.getBridgeDimensions()
    });
    this.sessionIds.set(slotId, session.id);
    return session;
  }

  restartSlot(slotId: TerminalSlotId): TerminalSessionSummary {
    const previousSessionId = this.sessionIds.get(slotId);
    if (previousSessionId && this.terminalSessionManager.hasSession(previousSessionId)) {
      this.terminalSessionManager.closeSession(previousSessionId);
    }

    this.sessionIds.delete(slotId);
    return this.ensureSession(slotId);
  }

  getSessionIdForSlot(slotId: TerminalSlotId): string | undefined {
    const sessionId = this.sessionIds.get(slotId);
    if (!sessionId || !this.terminalSessionManager.hasSession(sessionId)) {
      return undefined;
    }

    return sessionId;
  }

  attachSession(slotId: TerminalSlotId, sessionId: string): void {
    this.sessionIds.set(slotId, sessionId);
  }

  getSlotIdBySessionId(sessionId: string): TerminalSlotId | undefined {
    for (const [slotId, mappedSessionId] of this.sessionIds.entries()) {
      if (mappedSessionId === sessionId) {
        return slotId;
      }
    }

    return undefined;
  }

  handleSessionExit(sessionId: string): void {
    const slotId = this.getSlotIdBySessionId(sessionId);
    if (slotId) {
      this.sessionIds.delete(slotId);
    }
  }
}
