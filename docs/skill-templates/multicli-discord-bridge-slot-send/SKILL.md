---
name: multicli-discord-bridge-slot-send
description: Send plain text to slot1-slot8 of the running multicli-discord-bridge Electron app by calling the local slot-send CLI.
---

# multicli-discord-bridge slot send

Before using this template:

1. Copy it to `C:\Users\<your-user>\.copilot\skills\multicli-discord-bridge-slot-send\SKILL.md`
2. Replace `<repo-path>` with your local clone path

## Scope

- choose exactly one target slot
- send plain text
- optionally omit Enter
- optionally request a completion callback only when clearly needed
- do not expand into state inspection or visible-text inspection

## Repository

`<repo-path>`

## Primary command

```powershell
npm run slot:send -- --slot slot3 --from slot2 --text "This is Copilot in slot2. Review this diff."
```

Equivalent direct form:

```powershell
node .\scripts\bridge-send-slot.cjs --slot slot3 --from slot2 --text "This is Copilot in slot2. Review this diff."
```

## Multi-line text

```powershell
@'
line 1
line 2
'@ | node .\scripts\bridge-send-slot.cjs --slot slot3 --from slot2
```

## No-Enter send

```powershell
node .\scripts\bridge-send-slot.cjs --slot slot3 --from human --text "draft only" --no-enter
```

## Optional completion callback

Completion callbacks are **OFF by default**, including for AI-authored sends.

Only add `--notify-on-complete --origin-slot slotN` when:

- another slot AI truly needs a callback before deciding the next step
- or the user explicitly asks for a completion message back to the sender slot

```powershell
node .\scripts\bridge-send-slot.cjs --slot slot3 --from slot2 --text "This is Copilot in slot2. Notify slot2 when done." --notify-on-complete --origin-slot slot2
```

## When to switch to another skill

- If the task is a coordination flow such as handoff planning, report, target-slot selection, or cross-slot status confirmation, switch to **`multicli-discord-bridge-slot-state`** first.
- If the user explicitly wants visible terminal content, switch to **`multicli-discord-bridge-slot-text`**.

## Rules

1. Always send to exactly one slot per command.
2. Always pass `--from` with one of: `slot1-slot8`, `human`, `cron`, or `external:<label>`.
3. For AI-authored inter-slot requests, begin the body with a short self-introduction such as `This is Copilot in slot2.` when you know your sender label.
4. If you do not know your sender slot, ask the user first. Only if that would block the task may you switch to the text skill to identify yourself from visible text.
5. If the CLI says the Electron app is not running, report that plainly.
6. Do NOT enable completion callbacks by default.
