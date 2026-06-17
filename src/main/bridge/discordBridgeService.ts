import { app, type BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  AttachmentBuilder,
  ChannelType,
  Client,
  GatewayIntentBits,
  OverwriteType,
  PermissionFlagsBits,
  type Attachment,
  type Guild,
  type Message,
  type TextChannel
} from 'discord.js';
import type {
  TerminalSessionActivatedEvent,
  TerminalAutomationTurnResult,
  TerminalControlKey,
  TerminalSlotInboundKind,
  TerminalSessionRenameRequest,
  TerminalSessionSummary,
  TerminalSlotId,
  TerminalSlotSettingsUpdate,
  TerminalSlotSettingsUpdateResult
} from '../../shared/terminal';
import { ensureMainWindowReadyForTerminalInput } from '../app/ensureMainWindowReadyForTerminalInput';
import {
  MAX_BRIDGE_COLS,
  MAX_BRIDGE_ROWS,
  MIN_BRIDGE_COLS,
  MIN_BRIDGE_ROWS,
  PreferencesStore
} from '../app/preferencesStore';
import {
  ChannelSessionRegistry,
  type BridgeRequestRecord,
  type EnqueueRequestResult
} from './channelSessionRegistry';
import type { BridgeRuntimeConfig } from './bridgeConfig';
import { DiscordReplyFormatter } from './discordReplyFormatter';
import { TerminalAutomationService } from './terminalAutomationService';
import { buildWindowScreenshotFilename, captureWindowScreenshotPng } from './windowScreenshotCapture';
import { buildTerminalScreenshotFilename, captureTerminalScreenshotPng } from './terminalScreenshotCapture';
import { TerminalSessionManager } from '../terminal/terminalSessionManager';
import { TerminalSlotService } from '../app/terminalSlotService';
import { SlotStateStore } from '../app/slotStateStore';
import {
  DiscordAttachmentService,
  type DiscordAttachmentInput,
  type SavedDiscordAttachmentBatch
} from './discordAttachmentService';

const REACTION_PROCESSING = '⏳';
const REACTION_QUEUED = '🕒';
const REACTION_SUCCESS = '✅';
const REACTION_FAILURE = '⚠️';
const REACTION_REJECTED = '🚫';

const STOPPED_REPLY = '[stopped]';
const STOP_REQUESTED_REPLY = '[stop requested]';
const FORCE_STOPPED_REPLY = '[terminal force-stopped and restarted]';
const TERMINAL_RESTARTED_REPLY = '[terminal restarted]';
const TERMINAL_REDRAWN_REPLY = '[terminal redrawn]';
const APP_RESTARTING_REPLY = '[app restarting]';
const APP_READY_NOTIFICATION = '[multicli-discord-bridge ready: slot1 connected]';
const NO_ACTIVE_REQUEST_REPLY = '[no active request]';
const QUEUE_FULL_REPLY = 'Bridge busy: one request is already running and one is already queued.';
const AUTO_SCREENSHOT_ENABLED_REPLY = '[auto screenshot after reply: enabled]';
const AUTO_SCREENSHOT_DISABLED_REPLY = '[auto screenshot after reply: disabled]';
const AUTO_SCREENSHOT_STATUS_ON_REPLY = '[auto screenshot after reply: on]';
const AUTO_SCREENSHOT_STATUS_OFF_REPLY = '[auto screenshot after reply: off]';
const AUTO_SCREENSHOT_ATTACHMENT_REPLY = '[auto screenshot after completion: terminal]';
const HARD_TIMEOUT_UNLIMITED_ENABLED_REPLY = '[hard timeout: unlimited]';
const ATTACHMENTS_UNSUPPORTED_REPLY = '[attachments rejected: attachments are only supported on regular text messages]';
const ARTIFACT_CHANNEL_NAME = 'terminal-artifacts';
const ARTIFACT_CHANNEL_TOPIC = 'multicli-discord-bridge watched file uploads.';
const CRON_MESSAGE_CHUNK_LIMIT = 1900;
const REPEATED_ARROW_MIN_COUNT = 1;
const REPEATED_ARROW_MAX_COUNT = 20;
const TEXT_COMMAND_MIN_CHARS = 1;
const TEXT_COMMAND_MAX_CHARS = 9500;
const HELP_REPLY = [
  'Bridge commands:',
  '!help',
  '!restartterminal / !rst',
  '!redraw',
  '!restartapp / !rsa',
  '!stop -> send Ctrl+C and request stop',
  '!forcestop -> kill terminal and auto restart',
  '!enter',
  `!up / !up N / !upN (${REPEATED_ARROW_MIN_COUNT}-${REPEATED_ARROW_MAX_COUNT})`,
  `!down / !down N / !downN (${REPEATED_ARROW_MIN_COUNT}-${REPEATED_ARROW_MAX_COUNT})`,
  `!left / !left N / !leftN (${REPEATED_ARROW_MIN_COUNT}-${REPEATED_ARROW_MAX_COUNT})`,
  `!right / !right N / !rightN (${REPEATED_ARROW_MIN_COUNT}-${REPEATED_ARROW_MAX_COUNT})`,
  '!esc',
  '!ctrlc / !ctrl-c',
  '!screenshot / !ss',
  '!windowscreenshot / !wss',
  `!text N / !textN (${TEXT_COMMAND_MIN_CHARS}-${TEXT_COMMAND_MAX_CHARS})`,
  '!autoscreenshot',
  '!autoscreenshoton',
  '!autoscreenshotoff',
  `!cols / !cols N (${MIN_BRIDGE_COLS}-${MAX_BRIDGE_COLS})`,
  `!rows / !rows N (${MIN_BRIDGE_ROWS}-${MAX_BRIDGE_ROWS})`,
  '!hardtimeout',
  '!hardtimeoutunlimited',
  '!replyformat',
  '!replyformatcommand',
  '!replyformattext',
  '!/command -> send /command with Enter',
  '!noenterTEXT -> send TEXT without Enter or output wait'
].join('\n');

interface ProcessingLogEntry {
  requestId: string;
  messageId?: string;
  channelId: string;
  sessionId: string;
  requestState: BridgeRequestRecord['state'];
  kind: BridgeRequestRecord['kind'];
  startedAt: string;
  finishedAt: string;
  completionReason?: string;
  diffLength?: number;
  timeoutFlag: boolean;
  attachmentCount?: number;
  attachmentDirectory?: string;
  attachmentManifestPath?: string;
  attachmentTotalBytes?: number;
  error?: string;
}

interface RequestContext {
  message: Message;
}

interface DispatchParsedMessageRequest {
  message: Message;
  slotId: TerminalSlotId;
  parsed: ParsedBridgeMessage;
  requestUserId: string;
  inboundKind: TerminalSlotInboundKind;
  inboundFrom: string;
  attachmentBatch?: SavedDiscordAttachmentBatch;
}

interface CronDispatchRequest {
  name: string;
  slotId: TerminalSlotId;
  content: string;
}

interface DelayedInflightScreenshotHandle {
  cancel(): void;
}

type ParsedBridgeMessage =
  | { kind: 'ignore' }
  | { kind: 'error'; message: string }
  | { kind: 'help' }
  | { kind: 'restart-terminal' }
  | { kind: 'redraw' }
  | { kind: 'restart-app' }
  | { kind: 'stop' }
  | { kind: 'force-stop' }
  | { kind: 'settings'; setting: 'auto-screenshot'; value?: boolean }
  | { kind: 'settings'; setting: 'bridge-cols'; value?: number; error?: string }
  | { kind: 'settings'; setting: 'bridge-rows'; value?: number; error?: string }
  | { kind: 'settings'; setting: 'hard-timeout'; value?: number | null }
  | { kind: 'settings'; setting: 'reply-format'; value?: 'command' | 'plain-text' }
  | { kind: 'screenshot'; expectOutput: false }
  | { kind: 'window-screenshot'; expectOutput: false }
  | { kind: 'visible-text'; maxChars: number }
  | { kind: 'control'; key: TerminalControlKey; repeatCount?: number; expectOutput: boolean }
  | { kind: 'text'; content: string; expectOutput: boolean; appendEnter?: boolean };

type BusyPassthroughMessage =
  | Extract<ParsedBridgeMessage, { kind: 'control' }>
  | Extract<ParsedBridgeMessage, { kind: 'text' }>
  | Extract<ParsedBridgeMessage, { kind: 'screenshot' }>
  | Extract<ParsedBridgeMessage, { kind: 'window-screenshot' }>;

interface BridgeExecutionResult {
  completionReason: string;
  success: boolean;
  replyChunks: string[];
  diffLength: number;
  replyTextCategory: 'completion' | 'status';
  attachments?: AttachmentBuilder[];
}

interface ArtifactPublishFileRequest {
  watchDirectory: string;
  fullPath: string;
  relativePath: string;
  sizeBytes: number;
  buffer: Buffer;
}

interface ArtifactPublishErrorRequest {
  watchDirectory: string;
  fullPath: string;
  relativePath: string;
  sizeBytes: number;
  reason: 'file-too-large';
}

export class DiscordBridgeService {
  private client?: Client;
  private readonly requestContexts = new Map<string, RequestContext>();
  private readonly abortingChannels = new Set<string>();
  private readonly sessionActivatedListeners = new Set<(event: TerminalSessionActivatedEvent) => void>();
  private readonly replyFormatter: DiscordReplyFormatter;
  private readonly attachmentService: DiscordAttachmentService;

  constructor(
    private readonly channelSessionRegistry: ChannelSessionRegistry,
    private readonly terminalAutomationService: TerminalAutomationService,
    private readonly terminalSessionManager: TerminalSessionManager,
    private readonly terminalSlotService: TerminalSlotService,
    private readonly config: BridgeRuntimeConfig,
    private readonly getMainWindow: () => BrowserWindow | undefined,
    private readonly preferencesStore: PreferencesStore,
    private readonly slotStateStore?: SlotStateStore
  ) {
    this.replyFormatter = new DiscordReplyFormatter(config.reply);
    this.attachmentService = new DiscordAttachmentService(config, preferencesStore);
  }

  async start(): Promise<void> {
    if (!this.config.discordBotToken) {
      console.info('Discord bridge is disabled because DISCORD_BOT_TOKEN is not set.');
      return;
    }

    if (this.client) {
      return;
    }

    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
    });

    const waitForReady = new Promise<void>((resolve) => {
      client.once('clientReady', () => {
        resolve();
      });
    });

    client.once('clientReady', () => {
      console.info(`Discord bridge connected as ${client.user?.tag ?? 'unknown-user'}.`);
    });

    client.on('error', (error) => {
      console.error('Discord bridge client error', error);
    });

    client.on('messageCreate', (message) => {
      void this.handleMessage(message).catch((error) => {
        console.error('Discord bridge message handling failed', error);
      });
    });

    this.client = client;
    try {
      await client.login(this.config.discordBotToken);
      await waitForReady;
    } catch (error) {
      this.client = undefined;
      throw error;
    }
  }

  stop(): void {
    this.client?.destroy();
    this.client = undefined;
    this.requestContexts.clear();
    this.abortingChannels.clear();
  }

  onSessionActivated(listener: (event: TerminalSessionActivatedEvent) => void): () => void {
    this.sessionActivatedListeners.add(listener);
    return () => {
      this.sessionActivatedListeners.delete(listener);
    };
  }

  async ensureStartupBindings(): Promise<void> {
    for (const slot of this.terminalSlotService.listSlots()) {
      try {
        await this.ensureSlotBinding(slot.slotId);
      } catch (error) {
        console.error(`Failed to bind startup slot ${slot.slotId}`, error);
      }
    }

    try {
      await this.ensureArtifactChannelBinding();
    } catch (error) {
      console.error('Failed to bind artifact publish channel', error);
    }
  }

  async sendStartupReadyMessage(slotId: TerminalSlotId = 1): Promise<void> {
    if (!this.client?.isReady()) {
      return;
    }

    const slot = this.terminalSlotService.getSlot(slotId);
    if (!slot.channelId) {
      return;
    }

    const channel = await this.fetchGuildTextChannel(slot.channelId);
    if (!channel) {
      return;
    }

    await channel.send({
      content: APP_READY_NOTIFICATION,
      allowedMentions: {
        parse: []
      }
    });
  }

  async restartSlot(slotId: TerminalSlotId): Promise<TerminalSessionSummary> {
    const session = this.terminalSlotService.restartSlot(slotId);
    await this.ensureSlotBinding(slotId);
    return session;
  }

  async updateTerminalSlot(update: TerminalSlotSettingsUpdate): Promise<TerminalSlotSettingsUpdateResult> {
    const currentSlot = this.terminalSlotService.getSlot(update.slotId);
    const nextWorkspaceName = update.workspaceName?.trim() ? update.workspaceName.trim() : currentSlot.workspaceName;
    const nextCwd = update.cwd?.trim() ? update.cwd.trim() : currentSlot.cwd;
    const desiredChannelId = update.channelId === undefined ? currentSlot.channelId : update.channelId.trim();
    const nextStartupCommandEnabled =
      update.startupCommandEnabled === undefined ? currentSlot.startupCommandEnabled : Boolean(update.startupCommandEnabled);
    const nextStartupCommandText =
      update.startupCommandText === undefined ? currentSlot.startupCommandText : update.startupCommandText;

    const channel = await this.resolveDesiredChannel(update.slotId, desiredChannelId, nextWorkspaceName, nextCwd);
    const result = this.terminalSlotService.updateSlot({
      slotId: update.slotId,
      workspaceName: nextWorkspaceName,
      channelId: channel?.id ?? desiredChannelId,
      cwd: nextCwd,
      startupCommandEnabled: nextStartupCommandEnabled,
      startupCommandText: nextStartupCommandText
    });

    const session = result.session ?? this.getLiveSessionForSlot(update.slotId);
    if (session && channel) {
      this.channelSessionRegistry.registerWorkspaceBinding({
        slotId: update.slotId,
        channelId: channel.id,
        sessionId: session.id,
        workspaceName: result.slot.workspaceName
      });
    }

    return {
      slot: result.slot,
      session
    };
  }

  async renameSession(request: TerminalSessionRenameRequest): Promise<TerminalSessionSummary> {
    const slotId = this.terminalSlotService.getSlotIdBySessionId(request.sessionId);
    if (!slotId) {
      return this.terminalSessionManager.renameSession(request.sessionId, request.title);
    }
    const result = await this.updateTerminalSlot({
      slotId,
      workspaceName: request.title
    });
    return result.session ?? this.terminalSessionManager.renameSession(request.sessionId, result.slot.workspaceName);
  }

  async publishArtifactFile(request: ArtifactPublishFileRequest): Promise<void> {
    const channel = await this.ensureArtifactChannelBinding();
    if (!channel) {
      throw new Error('Artifact publish channel is not available.');
    }

    const attachment = new AttachmentBuilder(request.buffer, {
      name: path.basename(request.fullPath)
    });
    await channel.send({
      files: [attachment],
      allowedMentions: {
        parse: []
      }
    });
  }

  async publishArtifactError(request: ArtifactPublishErrorRequest): Promise<void> {
    const channel = await this.ensureArtifactChannelBinding();
    if (!channel) {
      throw new Error('Artifact publish channel is not available.');
    }

    await channel.send({
      content: buildArtifactPublishErrorMessage(request.watchDirectory, request.relativePath, request.fullPath, request.sizeBytes, request.reason),
      allowedMentions: {
        parse: []
      }
    });
  }

  async runCronJob(request: CronDispatchRequest): Promise<void> {
    const channel = await this.getBoundSlotChannel(request.slotId);
    const message = await this.sendCronStartMessage(channel, request);
    const parsed = parseBridgeMessage(request.content, this.client?.user?.id);
    if (parsed.kind === 'ignore') {
      return;
    }

    if (parsed.kind === 'error') {
      await this.tryAddReaction(message, REACTION_REJECTED);
      await this.sendReplies(message, this.formatReplyText(parsed.message));
      return;
    }

    await this.dispatchParsedMessage({
      message,
      slotId: request.slotId,
      parsed,
      requestUserId: `cron:${request.name}`,
      inboundKind: 'cron',
      inboundFrom: `cron:${request.name}`
    });
  }

  private async handleMessage(message: Message): Promise<void> {
    if (message.author.bot) {
      return;
    }

    if (!this.isAllowedUser(message.author.id) || !this.isAllowedGuild(message.guildId)) {
      return;
    }

    const slot = this.terminalSlotService.findSlotByChannelId(message.channelId);
    if (!slot) {
      return;
    }

    await this.ensureSlotBinding(slot.slotId);

    const attachments = [...message.attachments.values()];
    let parsed = parseBridgeMessage(message.content, this.client?.user?.id);
    let attachmentBatch: SavedDiscordAttachmentBatch | undefined;
    if (attachments.length > 0) {
      if (parsed.kind !== 'text' && parsed.kind !== 'ignore') {
        await this.tryAddReaction(message, REACTION_REJECTED);
        await this.sendReplies(message, this.formatReplyText(ATTACHMENTS_UNSUPPORTED_REPLY));
        return;
      }

      if (parsed.kind === 'ignore') {
        parsed = {
          kind: 'text',
          content: '',
          expectOutput: false
        };
      }

      try {
        attachmentBatch = await this.attachmentService.saveMessageAttachments({
          slotId: slot.slotId,
          channelId: message.channelId,
          messageId: message.id,
          createdAt: message.createdAt.toISOString(),
          attachments: attachments.map((attachment) => mapDiscordAttachment(attachment))
        });
      } catch (error) {
        await this.tryAddReaction(message, REACTION_REJECTED);
        await this.sendReplies(message, this.formatReplyText(toErrorMessage(error)));
        return;
      }
    }

    if (parsed.kind === 'ignore') {
      return;
    }

    if (parsed.kind === 'error') {
      await this.tryAddReaction(message, REACTION_REJECTED);
      await this.sendReplies(message, this.formatReplyText(parsed.message));
      return;
    }

    await this.dispatchParsedMessage({
      message,
      slotId: slot.slotId,
      parsed,
      requestUserId: message.author.id,
      inboundKind: 'discord',
      inboundFrom: `discord:${message.author.id}`,
      attachmentBatch
    });
  }

  private async handleEnqueueResult(result: EnqueueRequestResult): Promise<void> {
    const context = this.requestContexts.get(result.request.requestId);
    if (!context) {
      return;
    }

    if (result.disposition === 'rejected') {
      this.requestContexts.delete(result.request.requestId);
      await this.tryAddReaction(context.message, REACTION_REJECTED);
      await this.sendReplies(context.message, this.formatReplyText(QUEUE_FULL_REPLY));
      this.persistProcessingLog({
        requestId: result.request.requestId,
        messageId: result.request.messageId,
        channelId: result.request.channelId,
        sessionId: result.binding.sessionId,
        requestState: 'rejected',
        kind: result.request.kind,
        startedAt: result.request.createdAt,
        finishedAt: new Date().toISOString(),
        ...toAttachmentLogEntry(result.request.attachmentBatch),
        timeoutFlag: false
      });
      return;
    }

    if (result.disposition === 'queued') {
      await this.tryAddReaction(context.message, REACTION_QUEUED);
      return;
    }

    await this.tryAddReaction(context.message, REACTION_PROCESSING);
    void this.processRequest(result.binding.channelId, result.request);
  }

  private async dispatchParsedMessage(request: DispatchParsedMessageRequest): Promise<void> {
    const { message, slotId, parsed, requestUserId, inboundKind, inboundFrom, attachmentBatch } = request;
    if (parsed.kind === 'text' && parsed.content.trim().length > 0) {
      this.slotStateStore?.recordInbound(slotId, {
        timestamp: message.createdAt.toISOString(),
        from: inboundFrom,
        kind: inboundKind,
        text: parsed.content
      });
    }

    const binding = this.channelSessionRegistry.getBinding(message.channelId);
    if (binding && shouldActivateTerminalForMessage(parsed)) {
      this.emitSessionActivated(binding.sessionId);
    }

    if (parsed.kind === 'stop') {
      await this.handleStopCommand(message);
      return;
    }

    if (parsed.kind === 'force-stop') {
      await this.handleForceStopCommand(message, slotId);
      return;
    }

    if (parsed.kind === 'help') {
      await this.handleHelpCommand(message);
      return;
    }

    if (parsed.kind === 'restart-terminal') {
      await this.handleRestartTerminalCommand(message, slotId);
      return;
    }

    if (parsed.kind === 'redraw') {
      await this.handleRedrawCommand(message, slotId);
      return;
    }

    if (parsed.kind === 'restart-app') {
      await this.handleRestartAppCommand(message);
      return;
    }

    if (parsed.kind === 'settings') {
      await this.handleSettingsCommand(message, parsed);
      return;
    }

    if (parsed.kind === 'visible-text') {
      await this.handleVisibleTextCommand(message, slotId, parsed.maxChars);
      return;
    }

    if (binding?.status === 'busy' && isBusyPassthroughMessage(parsed) && !attachmentBatch) {
      await this.handleBusyPassthroughMessage(message, binding.sessionId, parsed);
      return;
    }

    if (!isBusyPassthroughMessage(parsed)) {
      return;
    }

    const enqueueResult = this.channelSessionRegistry.enqueue({
      channelId: message.channelId,
      kind: parsed.kind,
      userId: requestUserId,
      messageId: message.id,
      content: parsed.kind === 'text' ? parsed.content : undefined,
      attachmentBatch,
      appendEnter: parsed.kind === 'text' ? parsed.appendEnter : undefined,
      controlKey: parsed.kind === 'control' ? parsed.key : undefined,
      controlRepeatCount: parsed.kind === 'control' ? parsed.repeatCount : undefined,
      expectOutput: parsed.expectOutput
    });

    this.requestContexts.set(enqueueResult.request.requestId, { message });
    await this.handleEnqueueResult(enqueueResult);
  }

  private async handleStopCommand(message: Message): Promise<void> {
    await this.tryAddReaction(message, REACTION_PROCESSING);

    const binding = this.channelSessionRegistry.getBinding(message.channelId);
    if (!binding) {
      await this.tryAddReaction(message, REACTION_REJECTED);
        await this.sendReplies(message, this.formatReplyText(NO_ACTIVE_REQUEST_REPLY));
      return;
    }

    let aborted: ReturnType<ChannelSessionRegistry['abortChannel']>;
    try {
      aborted = this.channelSessionRegistry.abortChannel(message.channelId);
    } catch {
      await this.tryAddReaction(message, REACTION_REJECTED);
      await this.sendReplies(message, this.formatReplyText(NO_ACTIVE_REQUEST_REPLY));
      return;
    }

    if (!aborted.running) {
      await this.tryAddReaction(message, REACTION_REJECTED);
      await this.sendReplies(message, this.formatReplyText(NO_ACTIVE_REQUEST_REPLY));
      return;
    }

    this.abortingChannels.add(message.channelId);
    this.terminalAutomationService.requestAbort(aborted.binding.sessionId);

    if (aborted.cancelled) {
      await this.cancelQueuedRequest(aborted.cancelled);
    }

    await this.tryAddReaction(message, REACTION_SUCCESS);
    await this.sendReplies(message, this.formatReplyText(STOP_REQUESTED_REPLY));
  }

  private async handleForceStopCommand(message: Message, slotId: TerminalSlotId): Promise<void> {
    await this.tryAddReaction(message, REACTION_PROCESSING);

    const binding = this.channelSessionRegistry.getBinding(message.channelId);
    if (binding?.status === 'busy') {
      const aborted = this.channelSessionRegistry.abortChannel(message.channelId);
      this.abortingChannels.add(message.channelId);
      this.terminalAutomationService.requestAbort(aborted.binding.sessionId);

      if (aborted.cancelled) {
        await this.cancelQueuedRequest(aborted.cancelled);
      }
    }

    this.terminalSlotService.restartSlot(slotId);
    await this.ensureSlotBinding(slotId);

    await this.tryAddReaction(message, REACTION_SUCCESS);
    await this.sendReplies(message, this.formatReplyText(FORCE_STOPPED_REPLY));
  }

  private async handleHelpCommand(message: Message): Promise<void> {
    await this.tryAddReaction(message, REACTION_SUCCESS);
    await this.sendReplies(message, this.formatReplyText(HELP_REPLY));
  }

  private async handleBusyPassthroughMessage(
    message: Message,
    sessionId: string,
    parsed: BusyPassthroughMessage
  ): Promise<void> {
    const startedAt = new Date().toISOString();

    try {
      if (parsed.kind === 'text') {
        await ensureMainWindowReadyForTerminalInput(this.getMainWindow());
        await this.terminalAutomationService.sendInput({
          sessionId,
          content: parsed.content,
          appendEnter: parsed.appendEnter,
          source: 'bridge'
        });
      } else if (parsed.kind === 'control') {
        await ensureMainWindowReadyForTerminalInput(this.getMainWindow());
        await this.terminalAutomationService.sendControlKey(
          sessionId,
          parsed.key,
          parsed.repeatCount ?? 1,
          undefined,
          'bridge'
        );
      } else if (parsed.kind === 'screenshot') {
        await this.sendReplies(message, ['[terminal screenshot]'], [
          await this.createTerminalScreenshotAttachment(sessionId)
        ]);
      } else {
        await this.sendReplies(message, ['[app window screenshot]'], [await this.createWindowScreenshotAttachment()]);
      }

      this.persistProcessingLog({
        requestId: message.id,
        messageId: message.id,
        channelId: message.channelId,
        sessionId,
        requestState:
          parsed.kind === 'screenshot' || parsed.kind === 'window-screenshot' ? 'completed' : 'forwarded',
        kind: parsed.kind,
        startedAt,
        finishedAt: new Date().toISOString(),
        timeoutFlag: false
      });
      await this.tryAddReaction(message, REACTION_SUCCESS);
    } catch (error) {
      this.persistProcessingLog({
        requestId: message.id,
        messageId: message.id,
        channelId: message.channelId,
        sessionId,
        requestState: 'failed',
        kind: parsed.kind,
        startedAt,
        finishedAt: new Date().toISOString(),
        timeoutFlag: toErrorMessage(error).includes('timeout'),
        error: toErrorMessage(error)
      });
      await this.tryAddReaction(message, REACTION_FAILURE);
      await this.sendReplies(message, this.formatReplyText(`Bridge request failed: ${toErrorMessage(error)}`));
    }
  }

  private async handleRestartTerminalCommand(message: Message, slotId: TerminalSlotId): Promise<void> {
    await this.tryAddReaction(message, REACTION_PROCESSING);

    this.terminalSlotService.restartSlot(slotId);
    await this.ensureSlotBinding(slotId);

    await this.tryAddReaction(message, REACTION_SUCCESS);
    await this.sendReplies(message, this.formatReplyText(TERMINAL_RESTARTED_REPLY));
  }

  private async handleRedrawCommand(message: Message, slotId: TerminalSlotId): Promise<void> {
    await this.tryAddReaction(message, REACTION_PROCESSING);

    const session = this.getLiveSessionForSlot(slotId);
    if (!session) {
      await this.tryAddReaction(message, REACTION_REJECTED);
      await this.sendReplies(message, this.formatReplyText('[terminal redraw failed: no active session]'));
      return;
    }

    await this.terminalSessionManager.redrawJiggle({
      sessionId: session.id
    });

    await this.tryAddReaction(message, REACTION_SUCCESS);
    await this.sendReplies(message, this.formatReplyText(TERMINAL_REDRAWN_REPLY));
  }

  private async handleVisibleTextCommand(message: Message, slotId: TerminalSlotId, maxChars: number): Promise<void> {
    await this.tryAddReaction(message, REACTION_PROCESSING);

    const session = this.getLiveSessionForSlot(slotId);
    if (!session) {
      await this.tryAddReaction(message, REACTION_REJECTED);
      await this.sendReplies(message, this.formatReplyText('[visible text failed: no active session]'));
      return;
    }

    try {
      const visibleScreenText = await this.terminalSessionManager.getVisibleScreenText(session.id, {
        preserveWrapBoundaries: true
      });
      await this.tryAddReaction(message, REACTION_SUCCESS);
      await this.sendReplies(message, this.formatVisibleTextReply(visibleScreenText, maxChars));
    } catch (error) {
      await this.tryAddReaction(message, REACTION_FAILURE);
      await this.sendReplies(message, this.formatReplyText(`Bridge request failed: ${toErrorMessage(error)}`));
    }
  }

  private async handleRestartAppCommand(message: Message): Promise<void> {
    await this.tryAddReaction(message, REACTION_PROCESSING);
    await this.tryAddReaction(message, REACTION_SUCCESS);
    await this.sendReplies(message, this.formatReplyText(APP_RESTARTING_REPLY));

    const restartDelayMs = this.preferencesStore.getBridgeSettings().timing.appRestartDelayMs;
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, restartDelayMs);
  }

  private async handleSettingsCommand(
    message: Message,
    parsed: Extract<ParsedBridgeMessage, { kind: 'settings' }>
  ): Promise<void> {
    const current = this.preferencesStore.getBridgeSettings();
    if ('error' in parsed && parsed.error) {
      await this.tryAddReaction(message, REACTION_REJECTED);
      await this.sendReplies(message, this.formatReplyText(parsed.error));
      return;
    }

    if (parsed.setting === 'auto-screenshot') {
      const nextValue = parsed.value;
      if (nextValue === undefined) {
        await this.tryAddReaction(message, REACTION_SUCCESS);
        await this.sendReplies(message, this.formatReplyText(current.autoScreenshotOnReply ? AUTO_SCREENSHOT_STATUS_ON_REPLY : AUTO_SCREENSHOT_STATUS_OFF_REPLY));
        return;
      }

      const updated = this.preferencesStore.setBridgeSettings({
        autoScreenshotOnReply: nextValue
      });
      await this.tryAddReaction(message, REACTION_SUCCESS);
      await this.sendReplies(message, this.formatReplyText(updated.autoScreenshotOnReply ? AUTO_SCREENSHOT_ENABLED_REPLY : AUTO_SCREENSHOT_DISABLED_REPLY));
      return;
    }

    if (parsed.setting === 'bridge-cols') {
      const nextValue = parsed.value;
      if (nextValue === undefined) {
        await this.tryAddReaction(message, REACTION_SUCCESS);
        await this.sendReplies(message, this.formatReplyText(`[bridge cols: ${current.bridgeDimensions.cols}]`));
        return;
      }

      const updated = this.preferencesStore.setBridgeSettings({
        bridgeDimensions: {
          cols: nextValue
        }
      });
      this.terminalSessionManager.applyBridgeSettings();
      await this.tryAddReaction(message, REACTION_SUCCESS);
      await this.sendReplies(message, this.formatReplyText(`[bridge cols: ${updated.bridgeDimensions.cols}]`));
      return;
    }

    if (parsed.setting === 'bridge-rows') {
      const nextValue = parsed.value;
      if (nextValue === undefined) {
        await this.tryAddReaction(message, REACTION_SUCCESS);
        await this.sendReplies(message, this.formatReplyText(`[bridge rows: ${current.bridgeDimensions.rows}]`));
        return;
      }

      const updated = this.preferencesStore.setBridgeSettings({
        bridgeDimensions: {
          rows: nextValue
        }
      });
      this.terminalSessionManager.applyBridgeSettings();
      await this.tryAddReaction(message, REACTION_SUCCESS);
      await this.sendReplies(message, this.formatReplyText(`[bridge rows: ${updated.bridgeDimensions.rows}]`));
      return;
    }

    if (parsed.setting === 'reply-format') {
      const nextValue = parsed.value;
      if (nextValue === undefined) {
        await this.tryAddReaction(message, REACTION_SUCCESS);
        await this.sendReplies(message, this.formatReplyText(`[reply format: ${formatReplyFormat(current.replyFormat)}]`));
        return;
      }

      const updated = this.preferencesStore.setBridgeSettings({
        replyFormat: nextValue
      });
      await this.tryAddReaction(message, REACTION_SUCCESS);
      await this.sendReplies(message, this.formatReplyText(`[reply format: ${formatReplyFormat(updated.replyFormat)}]`));
      return;
    }

    const nextValue = parsed.value;
    if (nextValue === undefined) {
      await this.tryAddReaction(message, REACTION_SUCCESS);
      await this.sendReplies(message, this.formatReplyText(`[hard timeout: ${formatHardTimeout(current.hardTimeoutMs)}]`));
      return;
    }

    const updated = this.preferencesStore.setBridgeSettings({
      hardTimeoutMs: nextValue
    });
    await this.tryAddReaction(message, REACTION_SUCCESS);
    await this.sendReplies(
      message,
      this.formatReplyText(updated.hardTimeoutMs === null ? HARD_TIMEOUT_UNLIMITED_ENABLED_REPLY : `[hard timeout: ${formatHardTimeout(updated.hardTimeoutMs)}]`)
    );
  }

  private async processRequest(channelId: string, request: BridgeRequestRecord): Promise<void> {
    const context = this.requestContexts.get(request.requestId);
    if (!context) {
      return;
    }

    let binding = this.channelSessionRegistry.getBinding(channelId);
    if (!binding) {
      const slot = this.terminalSlotService.findSlotByChannelId(channelId);
      if (!slot) {
        throw new Error(`Unbound Discord channel: ${channelId}`);
      }

      await this.ensureSlotBinding(slot.slotId);
      binding = this.channelSessionRegistry.getBinding(channelId);
      if (!binding) {
        throw new Error(`Failed to bind Discord channel: ${channelId}`);
      }
    }

    await this.setInputLock(binding.sessionId, true);
    let skipUnlock = false;
    const delayedInflightScreenshot = this.scheduleInflightScreenshot(context.message, binding.sessionId, request);

    try {
      if (request.kind === 'text' || request.kind === 'control') {
        await ensureMainWindowReadyForTerminalInput(this.getMainWindow());
      }
      const result = await this.executeRequest(binding.sessionId, request);
      delayedInflightScreenshot?.cancel();
      const aborted = this.abortingChannels.has(channelId) || result.completionReason === 'aborted';

      if (aborted) {
        await this.sendReplies(context.message, this.formatReplyText(STOPPED_REPLY));
        await this.tryAddReaction(context.message, REACTION_REJECTED);
      } else if (!result.success) {
        throw new Error(`completion=${result.completionReason}`);
      } else {
        const replyChunks = this.shouldSendReplyText(result) ? result.replyChunks : [];
        if (replyChunks.length > 0 || (result.attachments?.length ?? 0) > 0) {
          await this.sendReplies(context.message, replyChunks, result.attachments);
        }
        await this.maybeSendAutoScreenshot(context.message, request, binding.sessionId);
        await this.tryAddReaction(context.message, REACTION_SUCCESS);
      }

      this.persistProcessingLog({
        requestId: request.requestId,
        messageId: request.messageId,
        channelId,
        sessionId: binding.sessionId,
        requestState: aborted ? 'cancelled' : 'completed',
        kind: request.kind,
        startedAt: request.createdAt,
        finishedAt: new Date().toISOString(),
        completionReason: result.completionReason,
        diffLength: result.diffLength,
        ...toAttachmentLogEntry(request.attachmentBatch),
        timeoutFlag: result.completionReason.includes('timeout')
      });
      await this.finishSuccessfulRequest(channelId, binding.sessionId, request.requestId, { skipUnlock });
    } catch (error) {
      delayedInflightScreenshot?.cancel();
      await this.finishFailedRequest(channelId, binding.sessionId, request, error, { skipUnlock });
    }
  }

  private async executeRequest(sessionId: string, request: BridgeRequestRecord): Promise<BridgeExecutionResult> {
    if (request.kind === 'text') {
      const content = buildTerminalRequestContent(request);
      if (request.attachmentBatch && (request.content?.trim().length ?? 0) === 0) {
        await this.terminalAutomationService.sendInput({
          sessionId,
          content,
          appendEnter: request.appendEnter,
          source: 'bridge'
        });
        return {
          completionReason: 'attachments_forwarded',
          success: true,
          replyChunks: this.formatReplyText(buildAttachmentSavedReply(request.attachmentBatch)),
          diffLength: 0,
          replyTextCategory: 'status'
        };
      }

      return this.mapAutomationResult(
        await this.terminalAutomationService.runAutomationTurn({
          sessionId,
          kind: 'text',
          content,
          appendEnter: request.appendEnter,
          expectOutput: request.expectOutput
        })
      );
    }

    if (request.kind === 'control') {
      return this.mapAutomationResult(
        await this.terminalAutomationService.runAutomationTurn({
          sessionId,
          kind: 'control',
          key: request.controlKey ?? 'enter',
          repeatCount: request.controlRepeatCount,
          expectOutput: request.expectOutput
        })
      );
    }

    if (request.kind === 'screenshot') {
      return {
        completionReason: 'snapshot_captured',
        success: true,
        replyChunks: ['[terminal screenshot]'],
        diffLength: 0,
        replyTextCategory: 'status',
        attachments: [await this.createTerminalScreenshotAttachment(sessionId)]
      };
    }

    if (request.kind === 'window-screenshot') {
      return {
        completionReason: 'snapshot_captured',
        success: true,
        replyChunks: ['[app window screenshot]'],
        diffLength: 0,
        replyTextCategory: 'status',
        attachments: [await this.createWindowScreenshotAttachment()]
      };
    }

    throw new Error(`Unsupported request kind: ${request.kind}`);
  }

  private mapAutomationResult(result: TerminalAutomationTurnResult): BridgeExecutionResult {
    return {
      completionReason: result.completion.reason,
      success: result.completion.success,
      replyChunks: result.replyChunks,
      diffLength: result.diff.diffText.length,
      replyTextCategory: 'completion'
    };
  }

  private shouldSendReplyText(result: BridgeExecutionResult): boolean {
    return result.replyTextCategory !== 'completion' || this.preferencesStore.getBridgeSettings().replyTextOnCompletion;
  }

  private async maybeSendAutoScreenshot(message: Message, request: BridgeRequestRecord, sessionId: string): Promise<void> {
    if (request.kind === 'screenshot' || request.kind === 'window-screenshot') {
      return;
    }

    if (!this.preferencesStore.getBridgeSettings().autoScreenshotOnReply) {
      return;
    }

    await this.sendReplies(message, this.formatReplyText(AUTO_SCREENSHOT_ATTACHMENT_REPLY), [
      await this.createTerminalScreenshotAttachment(sessionId)
    ]);
  }

  private scheduleInflightScreenshot(
    message: Message,
    sessionId: string,
    request: BridgeRequestRecord
  ): DelayedInflightScreenshotHandle | undefined {
    if (request.kind !== 'text' && request.kind !== 'control') {
      return undefined;
    }

    const settings = this.preferencesStore.getBridgeSettings();
    if (!settings.inflightScreenshotOnRunningRequest) {
      return undefined;
    }

    const elapsedMs = Math.max(0, Date.now() - Date.parse(request.createdAt));
    const delayMs = Math.max(0, settings.timing.inflightScreenshotDelayMs - elapsedMs);

    let cancelled = false;
    const timer = setTimeout(() => {
      void this.sendInflightScreenshotIfStillRunning(message, sessionId, request.requestId, () => cancelled);
    }, delayMs);

    return {
      cancel() {
        cancelled = true;
        clearTimeout(timer);
      }
    };
  }

  private async sendInflightScreenshotIfStillRunning(
    message: Message,
    sessionId: string,
    requestId: string,
    isCancelled: () => boolean
  ): Promise<void> {
    if (isCancelled()) {
      return;
    }

    const context = this.requestContexts.get(requestId);
    if (!context) {
      return;
    }

    try {
      await this.sendReplies(message, this.formatReplyText(this.getInflightScreenshotAttachmentReply()), [
        await this.createTerminalScreenshotAttachment(sessionId)
      ]);
    } catch (error) {
      console.warn(`Delayed inflight screenshot failed for request ${requestId}`, error);
    }
  }

  private getTerminalScreenshotTiming() {
    const timing = this.preferencesStore.getBridgeSettings().timing;
    return {
      readyTimeoutMs: timing.terminalScreenshotReadyTimeoutMs,
      pollIntervalMs: timing.terminalScreenshotPollIntervalMs,
      resizeSettleMs: timing.terminalScreenshotResizeSettleMs
    };
  }

  private async createTerminalScreenshotAttachment(sessionId: string): Promise<AttachmentBuilder> {
    const capturedAt = new Date().toISOString();
    return new AttachmentBuilder(await captureTerminalScreenshotPng(sessionId, this.getTerminalScreenshotTiming()), {
      name: buildTerminalScreenshotFilename(capturedAt)
    });
  }

  private async createWindowScreenshotAttachment(): Promise<AttachmentBuilder> {
    const mainWindow = this.getMainWindow();
    if (!mainWindow) {
      throw new Error('Main window is not available for screenshot capture.');
    }

    const capturedAt = new Date().toISOString();
    return new AttachmentBuilder(
      await captureWindowScreenshotPng(mainWindow, this.preferencesStore.getBridgeSettings().timing.windowScreenshotCaptureDelayMs),
      {
        name: buildWindowScreenshotFilename(capturedAt)
      }
    );
  }

  private async finishSuccessfulRequest(
    channelId: string,
    sessionId: string,
    requestId: string,
    options?: { skipUnlock?: boolean }
  ): Promise<void> {
    this.requestContexts.delete(requestId);
    this.terminalAutomationService.clearAbort(sessionId);
    this.abortingChannels.delete(channelId);

    const transition = this.channelSessionRegistry.markRunningCompleted(channelId);
    if (!transition.nextRequest) {
      if (!options?.skipUnlock) {
        await this.setInputLock(sessionId, false);
      }
      return;
    }

    const nextContext = this.requestContexts.get(transition.nextRequest.requestId);
    if (nextContext) {
      await this.tryAddReaction(nextContext.message, REACTION_PROCESSING);
    }

    void this.processRequest(channelId, transition.nextRequest);
  }

  private async finishFailedRequest(
    channelId: string,
    sessionId: string,
    request: BridgeRequestRecord,
    error: unknown,
    options?: { skipUnlock?: boolean }
  ): Promise<void> {
    const context = this.requestContexts.get(request.requestId);
    this.requestContexts.delete(request.requestId);
    this.terminalAutomationService.clearAbort(sessionId);
    this.abortingChannels.delete(channelId);

    const transition = this.channelSessionRegistry.failRunning(channelId);
    if (transition.cancelled) {
      await this.cancelQueuedRequest(transition.cancelled);
    }

    if (!options?.skipUnlock) {
      await this.setInputLock(sessionId, false);
    }

    if (!context) {
      return;
    }

    this.persistProcessingLog({
      requestId: request.requestId,
      messageId: request.messageId ?? context.message.id,
      channelId,
      sessionId,
      requestState: 'failed',
      kind: request.kind,
      startedAt: request.createdAt,
      finishedAt: new Date().toISOString(),
      ...toAttachmentLogEntry(request.attachmentBatch),
      timeoutFlag: toErrorMessage(error).includes('timeout'),
      error: toErrorMessage(error)
    });
    await this.tryAddReaction(context.message, REACTION_FAILURE);
    await this.sendReplies(context.message, this.formatReplyText(`Bridge request failed: ${toErrorMessage(error)}`));
  }

  private async cancelQueuedRequest(request: BridgeRequestRecord): Promise<void> {
    const context = this.requestContexts.get(request.requestId);
    this.requestContexts.delete(request.requestId);
    this.persistProcessingLog({
      requestId: request.requestId,
      messageId: request.messageId,
      channelId: request.channelId,
      sessionId: this.channelSessionRegistry.getBinding(request.channelId)?.sessionId ?? 'unknown',
      requestState: 'cancelled',
      kind: request.kind,
      startedAt: request.createdAt,
      finishedAt: new Date().toISOString(),
      ...toAttachmentLogEntry(request.attachmentBatch),
      timeoutFlag: false
    });
    if (!context) {
      return;
    }

    await this.tryAddReaction(context.message, REACTION_REJECTED);
  }

  private persistProcessingLog(entry: ProcessingLogEntry): void {
    mkdirSync(this.config.storage.processingLogDirectory, { recursive: true });
    const filename = `${entry.finishedAt.replace(/[:.]/g, '-')}-${entry.requestId}.json`;
    const filePath = path.join(this.config.storage.processingLogDirectory, filename);
    writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf8');
  }

  private async tryAddReaction(message: Message, emoji: string): Promise<void> {
    try {
      await message.react(emoji);
    } catch (error) {
      console.warn(`Discord reaction failed for message ${message.id}`, error);
    }
  }

  private async sendReplies(message: Message, chunks: string[], attachments?: AttachmentBuilder[]): Promise<void> {
    if (chunks.length === 0 && attachments && attachments.length > 0) {
      await message.reply({
        files: attachments,
        allowedMentions: {
          repliedUser: false
        }
      });
      return;
    }

    for (const [index, chunk] of chunks.entries()) {
      await message.reply({
        content: chunk,
        files: index === 0 ? attachments : undefined,
        allowedMentions: {
          repliedUser: false
        }
      });
    }
  }

  private formatReplyText(text: string): string[] {
    return this.replyFormatter.format(text, this.preferencesStore.getBridgeSettings().replyFormat);
  }

  private formatVisibleTextReply(text: string, maxChars: number): string[] {
    return this.replyFormatter.formatVisibleText(text, maxChars, this.preferencesStore.getBridgeSettings().replyFormat);
  }

  private getInflightScreenshotAttachmentReply(): string {
    const delaySeconds = Math.round(this.preferencesStore.getBridgeSettings().timing.inflightScreenshotDelayMs / 1000);
    return `[inflight screenshot after ${delaySeconds}s while running: terminal]`;
  }

  private async setInputLock(sessionId: string, locked: boolean): Promise<void> {
    try {
      await Promise.resolve(this.terminalAutomationService.setInputLock(sessionId, locked));
    } catch (error) {
      console.warn(`Failed to update input lock for session ${sessionId}`, error);
    }
  }

  private isAllowedUser(userId: string): boolean {
    return this.config.allowUserIds.length > 0 && this.config.allowUserIds.includes(userId);
  }

  private isAllowedGuild(guildId: string | null): boolean {
    if (!guildId) {
      return false;
    }

    return this.config.guildId === guildId;
  }

  private async ensureSlotBinding(slotId: TerminalSlotId): Promise<void> {
    const slot = this.terminalSlotService.getSlot(slotId);
    const session = this.terminalSlotService.ensureSession(slotId);
    const channel = await this.resolveDesiredChannel(slotId, slot.channelId, slot.workspaceName, slot.cwd);
    const finalChannelId = channel?.id ?? slot.channelId;
    if (finalChannelId !== slot.channelId) {
      this.terminalSlotService.updateSlot({
        slotId,
        channelId: finalChannelId
      });
    }

    if (!finalChannelId) {
      console.warn(`No Discord channel is bound for slot ${slotId}.`);
      return;
    }

    this.channelSessionRegistry.registerWorkspaceBinding({
      slotId,
      channelId: finalChannelId,
      sessionId: session.id,
      workspaceName: slot.workspaceName
    });
    console.info(`Bound slot ${slotId} to Discord channel ${finalChannelId}.`);
  }

  private async getBoundSlotChannel(slotId: TerminalSlotId): Promise<TextChannel> {
    if (!this.client?.isReady()) {
      throw new Error('Discord bridge client is not ready.');
    }

    await this.ensureSlotBinding(slotId);
    const slot = this.terminalSlotService.getSlot(slotId);
    if (!slot.channelId) {
      throw new Error(`No Discord channel is bound for slot ${slotId}.`);
    }

    const channel = await this.fetchGuildTextChannel(slot.channelId);
    if (!channel) {
      throw new Error(`Bound Discord channel ${slot.channelId} for slot ${slotId} is not available.`);
    }

    return channel;
  }

  private getLiveSessionForSlot(slotId: TerminalSlotId): TerminalSessionSummary | undefined {
    const sessionId = this.terminalSlotService.getSessionIdForSlot(slotId);
    if (!sessionId) {
      return undefined;
    }

    return this.terminalSessionManager.listSessions().find((session) => session.id === sessionId);
  }

  private async resolveDesiredChannel(
    slotId: TerminalSlotId,
    channelId: string,
    workspaceName: string,
    cwd: string
  ): Promise<TextChannel | undefined> {
    if (!this.client?.isReady()) {
      return undefined;
    }

    const channelName = normalizeWorkspaceChannelName(workspaceName);
    const desiredTopic = buildWorkspaceChannelTopic(slotId, workspaceName, cwd);
    return this.ensureManagedTextChannel(channelId, channelName, desiredTopic);
  }

  private async ensureArtifactChannelBinding(): Promise<TextChannel | undefined> {
    if (!this.client?.isReady()) {
      return undefined;
    }

    const settings = this.preferencesStore.getBridgeSettings();
    const channel = await this.ensureManagedTextChannel(settings.artifactPublish.channelId, ARTIFACT_CHANNEL_NAME, ARTIFACT_CHANNEL_TOPIC);
    const nextChannelId = channel?.id ?? '';
    if (nextChannelId !== settings.artifactPublish.channelId) {
      this.preferencesStore.setBridgeSettings({
        artifactPublish: {
          channelId: nextChannelId
        }
      });
    }
    return channel;
  }

  private async ensureManagedTextChannel(channelId: string, channelName: string, topic: string): Promise<TextChannel | undefined> {
    const existing = channelId ? await this.fetchGuildTextChannel(channelId) : undefined;

    if (existing) {
      if (existing.guildId !== this.config.guildId) {
        throw new Error(`Configured guild ${this.config.guildId} does not match channel ${channelId}.`);
      }

      if (existing.name !== channelName || existing.topic !== topic) {
        await existing.edit({
          name: channelName,
          topic
        });
      }
      return existing;
    }

    const guild = await this.resolveTargetGuildForSlot(channelId);
    if (!guild) {
      return undefined;
    }

    const botUserId = this.client?.user?.id;
    if (!botUserId) {
      throw new Error('Discord bot user is not ready for channel creation.');
    }

    return guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      topic,
      permissionOverwrites: buildAutoCreatedChannelPermissionOverwrites(guild, botUserId, this.config.allowUserIds)
    });
  }

  private async fetchGuildTextChannel(channelId: string): Promise<TextChannel | undefined> {
    const channel = await this.client?.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return undefined;
    }

    return channel as TextChannel;
  }

  private async resolveTargetGuildForSlot(existingChannelId: string): Promise<Guild | undefined> {
    if (!this.client?.isReady()) {
      return undefined;
    }

    if (existingChannelId) {
      const existingChannel = await this.fetchGuildTextChannel(existingChannelId);
      if (existingChannel) {
        if (existingChannel.guildId !== this.config.guildId) {
          throw new Error(`Configured guild ${this.config.guildId} does not match channel ${existingChannelId}.`);
        }
        return this.client.guilds.fetch(existingChannel.guildId);
      }
    }

    return this.client.guilds.fetch(this.config.guildId);
  }

  private emitSessionActivated(sessionId: string): void {
    for (const listener of this.sessionActivatedListeners) {
      listener({
        sessionId,
        source: 'discord'
      });
    }
  }

  private async sendCronStartMessage(channel: TextChannel, request: CronDispatchRequest): Promise<Message> {
    const chunks = splitDiscordMessageText(buildCronStartMessage(request), CRON_MESSAGE_CHUNK_LIMIT);
    const firstChunk = chunks.shift();
    if (!firstChunk) {
      throw new Error(`Failed to build cron start message for ${request.name}.`);
    }

    const message = await channel.send({
      content: firstChunk,
      allowedMentions: {
        parse: []
      }
    });

    for (const chunk of chunks) {
      await message.reply({
        content: chunk,
        allowedMentions: {
          repliedUser: false,
          parse: []
        }
      });
    }

    return message;
  }

}

export function parseBridgeMessage(content: string, botUserId?: string): ParsedBridgeMessage {
  const normalizedForCommand = stripBotMentions(content, botUserId).replace(/\r\n/g, '\n');
  const trimmedForCommand = normalizedForCommand.trim();
  const normalizedLower = trimmedForCommand.toLowerCase();
  const arrowCommand = parseRepeatedArrowCommand(normalizedLower);
  if (arrowCommand) {
    return arrowCommand;
  }
  const autoScreenshotCommand = parseAutoScreenshotCommand(normalizedLower);
  if (autoScreenshotCommand) {
    return autoScreenshotCommand;
  }
  const visibleTextCommand = parseVisibleTextCommand(trimmedForCommand);
  if (visibleTextCommand) {
    return visibleTextCommand;
  }

  switch (normalizedLower) {
    case '!ctrlc':
    case '!ctrl-c':
    case '[[terminal:ctrl-c]]':
      return { kind: 'control', key: 'ctrl-c', expectOutput: false };
    case '!esc':
    case '[[terminal:esc]]':
      return { kind: 'control', key: 'esc', expectOutput: false };
    case '!enter':
    case '[[terminal:enter]]':
      return { kind: 'control', key: 'enter', expectOutput: false };
    case '!screenshot':
    case '!ss':
    case '[[terminal:screenshot]]':
      return { kind: 'screenshot', expectOutput: false };
    case '!windowscreenshot':
    case '!wss':
    case '[[terminal:window-screenshot]]':
      return { kind: 'window-screenshot', expectOutput: false };
    case '!help':
    case '[[terminal:help]]':
      return { kind: 'help' };
    case '!restartterminal':
    case '!rst':
    case '[[terminal:restart-terminal]]':
      return { kind: 'restart-terminal' };
    case '!redraw':
    case '[[terminal:redraw]]':
      return { kind: 'redraw' };
    case '!restartapp':
    case '!rsa':
    case '[[terminal:restart-app]]':
      return { kind: 'restart-app' };
    case '!stop':
    case '[[terminal:stop]]':
      return { kind: 'stop' };
    case '!forcestop':
    case '[[terminal:force-stop]]':
      return { kind: 'force-stop' };
  }

  const noEnterCommand = parseNoEnterCommand(normalizedForCommand);
  if (noEnterCommand) {
    return noEnterCommand;
  }

  const slashEscapeCommand = parseSlashEscapeCommand(normalizedForCommand);
  if (slashEscapeCommand) {
    return slashEscapeCommand;
  }

  const normalizedText = normalizeBridgeText(content, botUserId);
  if (normalizedText.length === 0) {
    return { kind: 'ignore' };
  }

  return {
    kind: 'text',
    content: normalizedText,
    expectOutput: true
  };
}

function parseNoEnterCommand(content: string): Extract<ParsedBridgeMessage, { kind: 'text' }> | null {
  const leftTrimmed = content.trimStart();
  const prefix = '!noenter';
  if (!leftTrimmed.toLowerCase().startsWith(prefix)) {
    return null;
  }

  return {
    kind: 'text',
    content: leftTrimmed.slice(prefix.length),
    appendEnter: false,
    expectOutput: false
  };
}

function parseVisibleTextCommand(content: string): Extract<ParsedBridgeMessage, { kind: 'visible-text' | 'error' }> | null {
  if (content.length === 0) {
    return null;
  }

  const bracketMatch = content.match(/^\[\[terminal:text:(.+)\]\]$/i);
  if (bracketMatch) {
    return parseVisibleTextCount(bracketMatch[1]?.trim() ?? '');
  }

  const spacedMatch = content.match(/^!text\s+(.+)$/i);
  if (spacedMatch) {
    return parseVisibleTextCount(spacedMatch[1]?.trim() ?? '');
  }

  const compactMatch = content.match(/^!text(\d+)$/i);
  if (compactMatch) {
    return parseVisibleTextCount(compactMatch[1] ?? '');
  }

  if (/^!text$/i.test(content) || /^\[\[terminal:text\]\]$/i.test(content)) {
    return buildVisibleTextError(`[text: count must be an integer between ${TEXT_COMMAND_MIN_CHARS} and ${TEXT_COMMAND_MAX_CHARS}]`);
  }

  if (/^!text/i.test(content) || /^\[\[terminal:text:/i.test(content)) {
    return buildVisibleTextError(`[text: count must be an integer between ${TEXT_COMMAND_MIN_CHARS} and ${TEXT_COMMAND_MAX_CHARS}]`);
  }

  return null;
}

function parseVisibleTextCount(valueText: string): Extract<ParsedBridgeMessage, { kind: 'visible-text' | 'error' }> {
  if (!/^\d+$/.test(valueText)) {
    return buildVisibleTextError(`[text: count must be an integer between ${TEXT_COMMAND_MIN_CHARS} and ${TEXT_COMMAND_MAX_CHARS}]`);
  }

  const value = Number(valueText);
  if (value < TEXT_COMMAND_MIN_CHARS || value > TEXT_COMMAND_MAX_CHARS) {
    return buildVisibleTextError(`[text: count must be between ${TEXT_COMMAND_MIN_CHARS} and ${TEXT_COMMAND_MAX_CHARS}]`);
  }

  return {
    kind: 'visible-text',
    maxChars: value
  };
}

function buildVisibleTextError(message: string): Extract<ParsedBridgeMessage, { kind: 'error' }> {
  return {
    kind: 'error',
    message
  };
}

function parseRepeatedArrowCommand(content: string): Extract<ParsedBridgeMessage, { kind: 'control' | 'error' }> | null {
  const singleArrowCommands: Record<string, 'up' | 'down' | 'left' | 'right'> = {
    '!up': 'up',
    '[[terminal:up]]': 'up',
    '!down': 'down',
    '[[terminal:down]]': 'down',
    '!left': 'left',
    '[[terminal:left]]': 'left',
    '!right': 'right',
    '[[terminal:right]]': 'right'
  };
  const singleKey = singleArrowCommands[content];
  if (singleKey) {
    return { kind: 'control', key: singleKey, repeatCount: 1, expectOutput: false };
  }

  const bracketMatch = content.match(/^\[\[terminal:(up|down|left|right):(.+)\]\]$/);
  if (bracketMatch) {
    return parseArrowCountCommand(bracketMatch[1] as 'up' | 'down' | 'left' | 'right', bracketMatch[2]?.trim() ?? '');
  }

  const spacedMatch = content.match(/^!(up|down|left|right)\s+(.+)$/);
  if (spacedMatch) {
    return parseArrowCountCommand(spacedMatch[1] as 'up' | 'down' | 'left' | 'right', spacedMatch[2]?.trim() ?? '');
  }

  const compactMatch = content.match(/^!(up|down|left|right)(\d+)$/);
  if (compactMatch) {
    return parseArrowCountCommand(compactMatch[1] as 'up' | 'down' | 'left' | 'right', compactMatch[2] ?? '');
  }

  if (/^!(up|down|left|right)\s/.test(content) || /^\[\[terminal:(up|down|left|right):/.test(content)) {
    const key = content.includes('down') ? 'down' : content.includes('left') ? 'left' : content.includes('right') ? 'right' : 'up';
    return buildArrowCountError(key, `[${key}: count must be an integer between ${REPEATED_ARROW_MIN_COUNT} and ${REPEATED_ARROW_MAX_COUNT}]`);
  }

  return null;
}

function parseArrowCountCommand(
  key: 'up' | 'down' | 'left' | 'right',
  countText: string
): Extract<ParsedBridgeMessage, { kind: 'control' | 'error' }> {
  if (!/^\d+$/.test(countText)) {
    return buildArrowCountError(key, `[${key}: count must be an integer between ${REPEATED_ARROW_MIN_COUNT} and ${REPEATED_ARROW_MAX_COUNT}]`);
  }

  const count = Number(countText);
  if (count < REPEATED_ARROW_MIN_COUNT || count > REPEATED_ARROW_MAX_COUNT) {
    return buildArrowCountError(key, `[${key}: count must be between ${REPEATED_ARROW_MIN_COUNT} and ${REPEATED_ARROW_MAX_COUNT}]`);
  }

  return {
    kind: 'control',
    key,
    repeatCount: count,
    expectOutput: false
  };
}

function buildArrowCountError(
  _key: 'up' | 'down' | 'left' | 'right',
  message: string
): Extract<ParsedBridgeMessage, { kind: 'error' }> {
  return {
    kind: 'error',
    message
  };
}

function parseSlashEscapeCommand(content: string): Extract<ParsedBridgeMessage, { kind: 'text' }> | null {
  const leftTrimmed = content.trimStart();
  if (!leftTrimmed.startsWith('!/') || leftTrimmed.length <= 2 || /\s/.test(leftTrimmed[2] ?? '')) {
    return null;
  }

  return {
    kind: 'text',
    content: leftTrimmed.slice(1),
    appendEnter: true,
    expectOutput: true
  };
}

function parseAutoScreenshotCommand(content: string): Extract<ParsedBridgeMessage, { kind: 'settings' }> | null {
  switch (content) {
    case '!autoscreenshot':
    case '[[terminal:auto-screenshot]]':
      return { kind: 'settings', setting: 'auto-screenshot' };
    case '!autoscreenshoton':
    case '[[terminal:auto-screenshot:on]]':
      return { kind: 'settings', setting: 'auto-screenshot', value: true };
    case '!autoscreenshotoff':
    case '[[terminal:auto-screenshot:off]]':
      return { kind: 'settings', setting: 'auto-screenshot', value: false };
    default:
      return parseHardTimeoutCommand(content);
  }
}

function parseHardTimeoutCommand(content: string): Extract<ParsedBridgeMessage, { kind: 'settings' }> | null {
  switch (content) {
    case '!hardtimeout':
    case '[[terminal:hard-timeout]]':
      return { kind: 'settings', setting: 'hard-timeout' };
    case '!hardtimeoutunlimited':
    case '!hardtimeoutoff':
    case '[[terminal:hard-timeout:unlimited]]':
      return { kind: 'settings', setting: 'hard-timeout', value: null };
    default:
      return parseReplyFormatCommand(content);
  }
}

function parseReplyFormatCommand(content: string): Extract<ParsedBridgeMessage, { kind: 'settings' }> | null {
  switch (content) {
    case '!replyformat':
    case '[[terminal:reply-format]]':
      return { kind: 'settings', setting: 'reply-format' };
    case '!replyformatcommand':
    case '[[terminal:reply-format:command]]':
      return { kind: 'settings', setting: 'reply-format', value: 'command' };
    case '!replyformattext':
    case '[[terminal:reply-format:text]]':
      return { kind: 'settings', setting: 'reply-format', value: 'plain-text' };
    default:
      return parseBridgeDimensionCommand(content);
  }
}

function parseBridgeDimensionCommand(content: string): Extract<ParsedBridgeMessage, { kind: 'settings' }> | null {
  return (
    parseBridgeDimensionSettingCommand(content, {
      bangCommand: '!cols',
      queryCommand: '[[terminal:bridge-cols]]',
      valuePrefix: '[[terminal:bridge-cols:',
      setting: 'bridge-cols',
      min: MIN_BRIDGE_COLS,
      max: MAX_BRIDGE_COLS
    }) ??
    parseBridgeDimensionSettingCommand(content, {
      bangCommand: '!rows',
      queryCommand: '[[terminal:bridge-rows]]',
      valuePrefix: '[[terminal:bridge-rows:',
      setting: 'bridge-rows',
      min: MIN_BRIDGE_ROWS,
      max: MAX_BRIDGE_ROWS
    })
  );
}

function parseBridgeDimensionSettingCommand(
  content: string,
  options: {
    bangCommand: '!cols' | '!rows';
    queryCommand: '[[terminal:bridge-cols]]' | '[[terminal:bridge-rows]]';
    valuePrefix: '[[terminal:bridge-cols:' | '[[terminal:bridge-rows:';
    setting: 'bridge-cols' | 'bridge-rows';
    min: number;
    max: number;
  }
): Extract<ParsedBridgeMessage, { kind: 'settings' }> | null {
  if (content === options.queryCommand || content === options.bangCommand) {
    return { kind: 'settings', setting: options.setting };
  }

  const bangMatch = content.match(new RegExp(`^${escapeRegExp(options.bangCommand)}\\s+(.+)$`));
  if (bangMatch) {
    return parseBridgeDimensionValue(options.setting, bangMatch[1]?.trim() ?? '', options.min, options.max);
  }

  if (content.startsWith(options.valuePrefix) && content.endsWith(']]')) {
    return parseBridgeDimensionValue(
      options.setting,
      content.slice(options.valuePrefix.length, -2).trim(),
      options.min,
      options.max
    );
  }

  return null;
}

function parseBridgeDimensionValue(
  setting: 'bridge-cols' | 'bridge-rows',
  valueText: string,
  min: number,
  max: number
): Extract<ParsedBridgeMessage, { kind: 'settings' }> {
  if (!/^\d+$/.test(valueText)) {
    return {
      kind: 'settings',
      setting,
      error: `[${formatBridgeDimensionLabel(setting)}: enter an integer between ${min} and ${max}]`
    };
  }

  const value = Number(valueText);
  if (value < min || value > max) {
    return {
      kind: 'settings',
      setting,
      error: `[${formatBridgeDimensionLabel(setting)}: value must be between ${min} and ${max}]`
    };
  }

  return {
    kind: 'settings',
    setting,
    value
  };
}

function isBusyPassthroughMessage(parsed: ParsedBridgeMessage): parsed is BusyPassthroughMessage {
  return (
    parsed.kind === 'text' ||
    parsed.kind === 'control' ||
    parsed.kind === 'screenshot' ||
    parsed.kind === 'window-screenshot'
  );
}

function shouldActivateTerminalForMessage(parsed: ParsedBridgeMessage): boolean {
  switch (parsed.kind) {
    case 'text':
    case 'control':
    case 'screenshot':
    case 'window-screenshot':
    case 'stop':
    case 'force-stop':
    case 'restart-terminal':
    case 'redraw':
      return true;
    default:
      return false;
  }
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function mapDiscordAttachment(attachment: Attachment): DiscordAttachmentInput {
  return {
    id: attachment.id,
    url: attachment.url,
    name: attachment.name ?? undefined,
    sizeBytes: attachment.size,
    contentType: attachment.contentType ?? undefined
  };
}

function buildTerminalRequestContent(request: BridgeRequestRecord): string {
  if (!request.attachmentBatch) {
    return request.content ?? '';
  }

  if (!request.content || request.content.length === 0) {
    return request.attachmentBatch.contextBlock;
  }

  return `${request.attachmentBatch.contextBlock}\n\n${request.content}`;
}

function buildAttachmentSavedReply(batch: SavedDiscordAttachmentBatch): string {
  return `[attachments saved: ${batch.count} files]`;
}

function buildCronStartMessage(request: CronDispatchRequest): string {
  const header = `[cron start: ${request.name} -> slot${request.slotId}]`;
  const trimmedContent = request.content.trim();
  return trimmedContent.length > 0 ? `${header}\n${trimmedContent}` : header;
}

function splitDiscordMessageText(text: string, maxChunkLength: number): string[] {
  const lines = text.split('\n');
  const result: string[] = [];
  let current = '';

  for (const line of lines) {
    const next = current.length === 0 ? line : `${current}\n${line}`;
    if (next.length <= maxChunkLength) {
      current = next;
      continue;
    }

    if (current.length > 0) {
      result.push(current);
      current = '';
    }

    if (line.length <= maxChunkLength) {
      current = line;
      continue;
    }

    for (let index = 0; index < line.length; index += maxChunkLength) {
      result.push(line.slice(index, index + maxChunkLength));
    }
  }

  if (current.length > 0) {
    result.push(current);
  }

  return result.length > 0 ? result : [''];
}

function toAttachmentLogEntry(batch: SavedDiscordAttachmentBatch | undefined): Pick<
  ProcessingLogEntry,
  'attachmentCount' | 'attachmentDirectory' | 'attachmentManifestPath' | 'attachmentTotalBytes'
> {
  if (!batch) {
    return {};
  }

  return {
    attachmentCount: batch.count,
    attachmentDirectory: batch.directory,
    attachmentManifestPath: batch.manifestPath,
    attachmentTotalBytes: batch.totalBytes
  };
}

function normalizeWorkspaceChannelName(value: string): string {
  const normalized = value
    .trim()
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{Letter}\p{Number}-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);

  if (!normalized) {
    throw new Error('Workspace name must contain at least one letter or number.');
  }

  return normalized;
}

function buildWorkspaceChannelTopic(slotId: TerminalSlotId, workspaceName: string, cwd: string): string {
  return `multicli-discord-bridge slot ${slotId}: "${workspaceName}" (${cwd})`;
}

function buildAutoCreatedChannelPermissionOverwrites(guild: Guild, botUserId: string, allowUserIds: string[]) {
  const allowPermissions = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.AddReactions
  ];

  return [
    {
      id: guild.roles.everyone.id,
      type: OverwriteType.Role,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: botUserId,
      type: OverwriteType.Member,
      allow: [...allowPermissions, PermissionFlagsBits.ManageChannels]
    },
    ...[...new Set(allowUserIds)].map((userId) => ({
      id: userId,
      type: OverwriteType.Member,
      allow: allowPermissions
    }))
  ];
}

function buildArtifactPublishErrorMessage(
  watchDirectory: string,
  relativePath: string,
  fullPath: string,
  sizeBytes: number,
  reason: 'file-too-large'
): string {
  const reasonText =
    reason === 'file-too-large' ? 'file exceeds the current Discord upload limit for this bridge.' : 'artifact publish failed.';

  return [
    '[artifact publish skipped]',
    `reason: ${reasonText}`,
    `watch: \`${escapeInlineCode(watchDirectory)}\``,
    `path: \`${escapeInlineCode(relativePath)}\``,
    `local: \`${escapeInlineCode(fullPath)}\``,
    `size: ${formatByteSize(sizeBytes)}`,
    `updated: ${new Date().toISOString()}`
  ].join('\n');
}

function escapeInlineCode(value: string): string {
  return value.replace(/`/g, '\\`');
}

function formatByteSize(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

export function normalizeBridgeText(content: string, botUserId?: string): string {
  const withoutMentions = stripBotMentions(content, botUserId).replace(/\r\n/g, '\n');
  const withoutCodeFences = withoutMentions.replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1');
  return withoutCodeFences.trim();
}

function stripBotMentions(content: string, botUserId?: string): string {
  if (!botUserId) {
    return content;
  }

  return content.replace(new RegExp(`<@!?${escapeRegExp(botUserId)}>`, 'g'), '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wrapCodeBlock(text: string): string {
  return `\`\`\`text\n${text.replace(/```/g, '``\u200b`')}\n\`\`\``;
}

function formatHardTimeout(value: number | null): string {
  return value === null ? 'unlimited' : `${value} ms`;
}

function formatReplyFormat(value: 'command' | 'plain-text'): string {
  return value === 'plain-text' ? 'plain text' : 'command';
}

function formatBridgeDimensionLabel(value: 'bridge-cols' | 'bridge-rows'): string {
  return value === 'bridge-cols' ? 'bridge cols' : 'bridge rows';
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
