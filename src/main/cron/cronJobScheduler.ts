import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { app } from 'electron';
import * as nodeCron from 'node-cron';
import type { AppLogStore } from '../app/appLogStore';
import type { DiscordBridgeService } from '../bridge/discordBridgeService';
import type { TerminalSlotId } from '../../shared/terminal';

const CRON_JOBS_DIR = process.env['CRON_JOBS_DIR'] ?? path.join(app.getAppPath(), 'cron-jobs');
const DEFAULT_TIMEZONE = 'Asia/Tokyo';

interface CronJobConfig {
  name: string;
  cron: string;
  slot: TerminalSlotId;
  text: string;
  timezone?: string;
  active?: boolean;
}

export class CronJobScheduler {
  private readonly tasks = new Map<string, nodeCron.ScheduledTask>();
  private watcher?: FSWatcher;

  constructor(
    private readonly discordBridgeService: DiscordBridgeService,
    private readonly appLogStore?: AppLogStore
  ) {}

  start(): void {
    if (this.watcher) {
      return;
    }

    mkdirSync(CRON_JOBS_DIR, { recursive: true });
    this.watcher = chokidar.watch(CRON_JOBS_DIR, {
      ignoreInitial: false,
      depth: 0,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100
      }
    });
    this.watcher.on('add', (filePath) => {
      if (isJsonFile(filePath)) {
        this.registerJob(filePath);
      }
    });
    this.watcher.on('change', (filePath) => {
      if (isJsonFile(filePath)) {
        this.registerJob(filePath);
      }
    });
    this.watcher.on('unlink', (filePath) => {
      if (isJsonFile(filePath)) {
        this.unregisterJob(filePath);
      }
    });
    this.log(`started dir=${CRON_JOBS_DIR}`);
  }

  stop(): void {
    for (const task of this.tasks.values()) {
      task.stop();
    }
    this.tasks.clear();

    if (this.watcher) {
      void this.watcher.close();
      this.watcher = undefined;
    }

    this.log('stopped');
  }

  private registerJob(filePath: string): void {
    const name = path.basename(filePath, '.json');
    this.unregisterJob(filePath);

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (error) {
      this.log(`parse error name=${name} error=${formatError(error)}`);
      return;
    }

    const parsedJob = parseCronJobConfig(parsed, name);
    if (!parsedJob.ok) {
      this.log(`invalid job name=${name} error=${parsedJob.error}`);
      return;
    }
    const job = parsedJob.job;

    if (job.active === false) {
      this.log(`skipped (inactive) name=${name}`);
      return;
    }

    if (!isFiveFieldCron(job.cron) || !nodeCron.validate(job.cron)) {
      this.log(`invalid cron name=${name} cron=${JSON.stringify(job.cron)}`);
      return;
    }

    const task = nodeCron.schedule(
      job.cron,
      () => {
        void this.executeJob(job);
      },
      {
        timezone: job.timezone ?? DEFAULT_TIMEZONE
      }
    );

    this.tasks.set(name, task);
    this.log(`registered name=${name} cron=${JSON.stringify(job.cron)} slot=${job.slot}`);
  }

  private unregisterJob(filePath: string): void {
    const name = path.basename(filePath, '.json');
    const existing = this.tasks.get(name);
    if (!existing) {
      return;
    }

    existing.stop();
    this.tasks.delete(name);
    this.log(`unregistered name=${name}`);
  }

  private async executeJob(job: CronJobConfig): Promise<void> {
    this.log(`executing name=${job.name} slot=${job.slot}`);
    try {
      await this.discordBridgeService.runCronJob({
        name: job.name,
        slotId: job.slot,
        content: job.text
      });
      this.log(`done name=${job.name} slot=${job.slot} deliveredTextLength=${job.text.length}`);
    } catch (error) {
      this.log(`failed name=${job.name} slot=${job.slot} error=${formatError(error)}`);
    }
  }

  private log(message: string): void {
    const line = `[cron] ${message}\n`;
    console.log(line.trimEnd());
    this.appLogStore?.appendMessage('stdout', line);
  }
}

function parseCronJobConfig(
  parsed: unknown,
  expectedName: string
): { ok: true; job: CronJobConfig } | { ok: false; error: string } {
  if (!isRecord(parsed)) {
    return { ok: false, error: 'job file must contain a JSON object' };
  }

  const { name, cron, slot, text, timezone, active } = parsed;
  if (typeof name !== 'string' || name.length === 0) {
    return { ok: false, error: 'name must be a non-empty string' };
  }

  if (name !== expectedName) {
    return { ok: false, error: `name must match file name (${expectedName})` };
  }

  if (typeof cron !== 'string' || cron.length === 0) {
    return { ok: false, error: 'cron must be a non-empty string' };
  }

  if (!isTerminalSlotId(slot)) {
    return { ok: false, error: 'slot must be 1, 2, 3, 4, 5, 6, 7, or 8' };
  }

  if (typeof text !== 'string' || text.length === 0) {
    return { ok: false, error: 'text must be a non-empty string' };
  }

  if (typeof timezone !== 'undefined' && typeof timezone !== 'string') {
    return { ok: false, error: 'timezone must be a string when provided' };
  }

  if (typeof active !== 'undefined' && typeof active !== 'boolean') {
    return { ok: false, error: 'active must be a boolean when provided' };
  }

  return {
    ok: true,
    job: {
      name,
      cron,
      slot,
      text,
      timezone,
      active
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTerminalSlotId(value: unknown): value is TerminalSlotId {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6 || value === 7 || value === 8;
}

function isFiveFieldCron(value: string): boolean {
  return value.trim().split(/\s+/).length === 5;
}

function isJsonFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === '.json';
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
