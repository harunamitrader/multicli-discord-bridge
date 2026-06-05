---
name: multicli-discord-bridge-slot-state
description: Read coordination state for slot1-slot8 of the running multicli-discord-bridge Electron app by calling the local slot-observe CLI.
---

# multicli-discord-bridge slot state

Before using this template:

1. Copy it to `C:\Users\<your-user>\.copilot\skills\multicli-discord-bridge-slot-state\SKILL.md`
2. Replace `<repo-path>` with your local clone path

## Scope

- read slot coordination state
- optionally filter to one slot
- summarize `cwd`, `status`, `updatedAt`, `foregroundCommand`, and `recentInbound`
- do not send text
- do not infer hidden runtime semantics beyond the recorded state

## Repository

`<repo-path>`

## Primary commands

Read all slots:

```powershell
npm run slot:observe -- --state
```

Read one slot:

```powershell
npm run slot:observe -- --slot slot3 --state
```

Equivalent direct form:

```powershell
node .\scripts\bridge-observe.cjs --state
node .\scripts\bridge-observe.cjs --slot slot3 --state
```

## What the JSON contains

- `cwd`
- `status`
- `updatedAt`
- `foregroundCommand`
- `recentInbound`

`foregroundCommand` means only the **first Enter-submitted command after the last `promptReady`**. It is not a semantic runtime classifier.

## When to use this skill

- before inter-slot handoff
- before choosing which slot should receive a request
- when the user asks what each slot is doing
- when the user asks for recent inbound context across slots

## When to switch to another skill

- If raw visible terminal text is needed, switch to **`multicli-discord-bridge-slot-text`**.
- If the task is to actually inject text into another slot, switch to **`multicli-discord-bridge-slot-send`**.

## Rules

1. Do not send any text while using this skill.
2. Prefer `--state` first over per-slot text reads when the task is coordination-oriented.
3. If one target slot is enough, prefer `--slot slotN --state` over reading all slots.
4. Treat `foregroundCommand` as recorded state only; do not reinterpret it as a guaranteed runtime identity.
