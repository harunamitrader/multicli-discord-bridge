---
name: multicli-discord-bridge-slot-text
description: Read visible text from slot1-slot8 of the running multicli-discord-bridge Electron app by calling the local slot-observe CLI.
---

# multicli-discord-bridge slot text

Before using this template:

1. Copy it to `C:\Users\<your-user>\.copilot\skills\multicli-discord-bridge-slot-text\SKILL.md`
2. Replace `<repo-path>` with your local clone path

## Scope

- choose one slot at a time
- read visible terminal text
- optionally limit length with `--max-chars`
- do not send text
- do not reinterpret the text as hidden runtime state

## Repository

`<repo-path>`

## Primary command

```powershell
npm run slot:observe -- --slot slot3 --text
```

With an optional length limit:

```powershell
npm run slot:observe -- --slot slot3 --text --max-chars 2000
```

Equivalent direct form:

```powershell
node .\scripts\bridge-observe.cjs --slot slot3 --text
```

## When to use this skill

- when the user explicitly asks what is visible in a slot
- when the state skill is not enough and actual terminal text is needed
- when sender-slot identification would otherwise block a send and visible text is the least invasive fallback

## When to switch to another skill

- If lightweight coordination state is enough, switch to **`multicli-discord-bridge-slot-state`** instead.
- If the task is to send text into another slot, switch to **`multicli-discord-bridge-slot-send`**.

## Rules

1. Read one slot per command unless the user explicitly asks for several slots.
2. Prefer the state skill first for coordination-oriented tasks.
3. Prefer visible text before screenshots when text is enough.
4. Do not send any text while using this skill.
