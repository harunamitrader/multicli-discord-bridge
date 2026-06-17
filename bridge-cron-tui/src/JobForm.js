import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { describeNext, validateCron } from './cronUtils.js';

const h = React.createElement;
const FIELD_ORDER = ['name', 'cron', 'slot', 'text', 'timezone', 'active'];

export default function JobForm({ mode, initialJob, onSave, onCancel }) {
  const [name, setName] = useState(initialJob?.name ?? '');
  const [cron, setCronExpr] = useState(initialJob?.cron ?? '0 9 * * *');
  const [slot, setSlot] = useState(normalizeSlot(initialJob?.slot));
  const [text, setText] = useState(initialJob?.text ?? '');
  const [timezone, setTimezone] = useState(initialJob?.timezone ?? 'Asia/Tokyo');
  const [active, setActive] = useState(initialJob?.active !== false);
  const [fieldIndex, setFieldIndex] = useState(0);
  const [submitError, setSubmitError] = useState('');

  const cronValid = useMemo(() => validateCron(cron), [cron]);
  const cronDescription = useMemo(() => describeNext(cron), [cron]);
  const activeField = FIELD_ORDER[fieldIndex];

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.tab || key.downArrow) {
      setFieldIndex((current) => (current + 1) % FIELD_ORDER.length);
      return;
    }

    if (key.upArrow) {
      setFieldIndex((current) => (current + FIELD_ORDER.length - 1) % FIELD_ORDER.length);
      return;
    }

    if (key.return) {
      if (activeField === 'slot') {
        setFieldIndex((current) => (current + 1) % FIELD_ORDER.length);
        return;
      }

      if (activeField === 'active') {
        const validationError = validateForm({ name, cron, slot, text, timezone });
        if (validationError) {
          setSubmitError(validationError);
          return;
        }

        setSubmitError('');
        onSave({
          name: name.trim(),
          cron: cron.trim(),
          slot,
          text,
          timezone: timezone.trim(),
          active
        });
        return;
      }

      setFieldIndex((current) => Math.min(current + 1, FIELD_ORDER.length - 1));
      return;
    }

    if (activeField === 'slot') {
      if (key.leftArrow) {
        setSlot((current) => (current === 1 ? 8 : current - 1));
        return;
      }

      if (key.rightArrow) {
        setSlot((current) => (current === 8 ? 1 : current + 1));
        return;
      }

      if (/^[1-8]$/.test(input)) {
        setSlot(Number(input));
        return;
      }
    }

    if (activeField === 'active' && input === ' ') {
      setActive((current) => !current);
    }
  });

  const legend = [
    '  分 時 日 月 曜',
    '  0 9 * * *      → 毎日 09:00',
    '  0 10 * * 1     → 毎週月曜 10:00',
    '  30 8,20 * * *  → 毎日 8:30 と 20:30',
    '  0 */6 * * *    → 6時間ごと',
    '  * * * * *      → 毎分',
  ].join('\n');

  return h(
    Box,
    { flexDirection: 'column' },
    h(
      Box,
      { flexDirection: 'column', borderStyle: 'round', borderColor: 'cyan', paddingX: 1 },
    h(Text, { bold: true, color: 'cyanBright' }, mode === 'edit' ? 'ジョブ編集' : 'ジョブ追加'),
    h(FormRow, {
      label: 'name',
      focused: activeField === 'name',
      control: h(TextInput, {
        value: name,
        onChange: setName,
        focus: activeField === 'name',
        placeholder: 'morning-task'
      })
    }),
    h(FormRow, {
      label: 'cron',
      focused: activeField === 'cron',
      control: h(TextInput, {
        value: cron,
        onChange: setCronExpr,
        focus: activeField === 'cron',
        placeholder: '0 9 * * *'
      }),
      suffix: cron.length === 0 ? '' : cronDescription,
      suffixColor: cronValid ? 'green' : 'red'
    }),
    h(FormRow, {
      label: 'slot',
      focused: activeField === 'slot',
      control: h(
        Text,
        { color: activeField === 'slot' ? 'cyanBright' : undefined },
        `[${slot}] (←/→ または 1-8)`
      )
    }),
    h(FormRow, {
      label: 'text',
      focused: activeField === 'text',
      control: h(TextInput, {
        value: text,
        onChange: setText,
        focus: activeField === 'text',
        placeholder: 'python analyze.py'
      })
    }),
    h(FormRow, {
      label: 'timezone',
      focused: activeField === 'timezone',
      control: h(TextInput, {
        value: timezone,
        onChange: setTimezone,
        focus: activeField === 'timezone',
        placeholder: 'Asia/Tokyo'
      })
    }),
    h(FormRow, {
      label: 'active',
      focused: activeField === 'active',
      control: h(
        Text,
        { color: activeField === 'active' ? 'cyanBright' : undefined },
        `[${active ? '✓' : ' '}] (Spaceで切替 / Enterで保存)`
      )
    }),
    submitError ? h(Text, { color: 'redBright' }, `エラー: ${submitError}`) : null,
    h(Text, { color: 'gray' }, '[↑↓/Tab]移動  [Enter]進む/保存  [Esc]キャンセル')
    ),
    h(Text, { color: 'gray', dimColor: true }, 'cron 凡例:'),
    h(Text, { color: 'gray', dimColor: true }, legend)
  );
}

function FormRow({ label, focused, control, suffix, suffixColor }) {
  return h(
    Box,
    { marginTop: 1 },
    h(Text, { color: focused ? 'cyanBright' : undefined }, `${label}: `.padEnd(11, ' ')),
    control,
    suffix ? h(Text, { color: suffixColor ?? 'gray', wrap: 'truncate-end' }, `  ${suffix}`) : null
  );
}

function normalizeSlot(value) {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6 || value === 7 || value === 8 ? value : 1;
}

function validateForm({ name, cron, slot, text, timezone }) {
  if (name.trim().length === 0) {
    return 'name は必須です';
  }

  if (!validateCron(cron)) {
    return 'cron 式が無効です';
  }

  if (![1, 2, 3, 4, 5, 6, 7, 8].includes(slot)) {
    return 'slot は 1-8 です';
  }

  if (text.length === 0) {
    return 'text は必須です';
  }

  if (timezone.trim().length === 0) {
    return 'timezone は必須です';
  }

  return '';
}
