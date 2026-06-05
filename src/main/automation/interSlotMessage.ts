const SLOT_FROM_LABEL_PATTERN = /^slot[1-8]$/;
const EXTERNAL_FROM_LABEL_PATTERN = /^external:[a-z0-9._-]+$/;
const RESERVED_FROM_LABELS = new Set(['human', 'cron']);

export function normalizeInterSlotFromLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    throw new Error('from is required.');
  }

  if (
    SLOT_FROM_LABEL_PATTERN.test(normalized) ||
    RESERVED_FROM_LABELS.has(normalized) ||
    EXTERNAL_FROM_LABEL_PATTERN.test(normalized)
  ) {
    return normalized;
  }

  throw new Error('from must be slot1-slot8, human, cron, or external:<label>.');
}

export function formatInterSlotMessage(fromLabel: string, text: string): string {
  return [`[from: ${normalizeInterSlotFromLabel(fromLabel)}]`, text].join('\n');
}
