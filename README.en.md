# multicli-discord-bridge

**Language:** [日本語](README.md) | English

<p align="center">
  <img src="docs/images/readme-header.png" alt="multicli-discord-bridge header" />
</p>

multicli-discord-bridge is a **local desktop app for running multiple AI CLIs in one window and controlling them from Discord**.  
You can watch six slots at once, send instructions to each slot from Discord, and follow replies or progress without sitting in front of the machine. The main goal is not just remote terminal control, but **orchestrating multiple AI CLIs on different tasks in parallel and letting slots collaborate when needed**.

> **Important premise**
>
> This tool **runs local terminals / CLIs on your own PC**.  
> In other words, anything sent by approved Discord users becomes an operation against your PC. This is not a general-purpose bot for public servers. Treat it as a **local orchestration tool for personal or small-team use**.

## Visual overview

<p align="center">
  <img src="docs/images/readme-showcase-01.png" alt="multicli-discord-bridge showcase visual 1" width="420" />
</p>

## Screenshots

### UI overview

<img src="docs/images/readme-screenshot-01.png" alt="multicli-discord-bridge UI overview screenshot" width="760" />

### Example Discord response

<img src="docs/images/discord-response.jpg" alt="Discord response example" width="420" />

## What it can do

- Show **eight fixed slots in one window** at the same time, arranged as `slot1 / slot3 / slot5 / slot7` on top and `slot2 / slot4 / slot6 / slot8` on the bottom
- Drag three vertical dividers and one horizontal divider to resize the **visible pane layout only**, while keeping the internal terminal size fixed
- Bind one Discord channel to one slot and use **Discord as the control surface**
- Send Discord text directly into the target slot's terminal / CLI
- Reply to Discord with the detected output diff so you can track work remotely
- Return a **terminal screenshot** with `!screenshot` / `!ss` even while busy, without forcing a redraw
- Return an **app window screenshot** with `!windowscreenshot` / `!wss` even while busy
- Return the tail of the **currently visible terminal text** with `!text N` / `!textN`
- Watch the `discord-publish` folder under terminal 1's working directory and automatically upload newly created or updated files to a shared artifact channel
- Accept additional input from Discord or the app while a request is already running
- Use bundled skill templates as a standard feature for **slot-to-slot sends, shared state checks, and visible-text reads**
- Combine **slot-to-slot sends, state checks, visible-text reads, and opt-in completion callbacks** for AI handoff flows
- Send scheduled prompts or commands to a chosen slot with **cron**
- In the app terminal, use `Ctrl+C` to copy the current selection and `Ctrl+V` to paste clipboard text into the session
- Let you watch the same live session from the app UI

## What this app is good for

- Running Copilot CLI / Claude Code / Codex CLI / Gemini CLI / Antigravity CLI on different tasks in parallel
- Giving different slots different roles such as drafting, review, retry, or follow-up work
- Accessing your home PC AI workspace from Discord while away from the machine
- Seeing what every slot is doing at a glance and sending follow-up instructions only where needed

## Current limitations

- **Windows only**
- Uses normal Discord messages, not slash commands
- The current default shell implementation is **PowerShell**
- Switching between multiple shell types such as cmd / bash / zsh / WSL is not supported yet
- Distributed as source code for now, not as an installer package

## What you need first

Before you start, prepare these things:

1. **A Windows PC**
2. **Node.js 20 or later**
3. **A Discord account**
4. **A Discord server you control**
5. **Any AI CLIs or dev tools you want to run** (optional: Copilot CLI, Claude Code, Codex CLI, Gemini CLI, and so on)

Internally the app uses PowerShell. The built-in Windows version works, but **PowerShell 7** is recommended.

## Setup

### 1. Put this repository on your PC

If you use Git:

```powershell
git clone https://github.com/harunamitrader/multicli-discord-bridge.git
cd multicli-discord-bridge
```

If you do not use Git, download the repository from **Code > Download ZIP** on GitHub and extract it somewhere easy to find.

### 2. Create a Discord bot

1. Open the Discord Developer Portal
2. Create a new application with **New Application**
3. Add a **Bot**
4. Generate and save the bot token
5. Enable **MESSAGE CONTENT INTENT**
6. In the OAuth2 URL Generator, select the **bot** scope, choose the required permissions, create an invite URL, and invite the bot to your Discord server

At minimum, the bot needs these permissions:

- **View Channels**
- **Send Messages**
- **Attach Files**
- **Add Reactions**
- **Manage Channels** (if you want automatic channel creation, renaming, or topic updates)

This app can **auto-create, reuse, and rename** the slot channels and the shared artifact channel `terminal-artifacts`. Auto-created channels default to permission overwrites that make them visible only to the allowed users and the bot.
If you use that behavior, **Manage Channels** is required. If you create the channels yourself and set the channel IDs manually, you can avoid granting that permission.

### 3. Enable copying IDs in Discord

Turn on **Settings > Advanced > Developer Mode** in Discord.  
Then you can copy user IDs and guild IDs from the right-click menu.

You need:

- **Your own user ID**
- **The single guild ID you want to allow**

## 4. Create the config file

Copy `.env.example` to `.env` in this folder.

```powershell
Copy-Item .env.example .env
```

Open `.env` in Notepad or another editor and change at least these values:

```env
DISCORD_BOT_TOKEN=put-your-bot-token-here
ALLOW_USER_IDS=put-your-discord-user-id-here
ALLOW_GUILD_ID=put-your-target-guild-id-here
```

### Notes

- `.env` is loaded automatically when the app starts
- `ALLOW_GUILD_ID` is **required** and must contain **exactly one** guild ID
- If `ALLOW_USER_IDS` is left empty, the app accepts no user messages for safety
- Older names such as `DISCORD_ALLOWED_USER_ID` and `DISCORD_ALLOWED_GUILD_IDS` are still supported for compatibility, but guild-side config must still resolve to **exactly one** ID or startup fails

## 5. First launch

The simplest way is to run this file from the project root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\launch-multicli-discord-bridge.ps1
```

This launcher automatically does the following if needed. It checks both `dist\renderer` and `dist-electron`, and rebuilds when outputs are missing or stale after source changes.

- `npm install`
- `npm run build`
- `npm run start`

If you want to do it manually:

```powershell
npm install
npm run build
npm start
```

- On **PowerShell 7 or later**, it is fine to chain them as `npm install && npm run build && npm start`
- On **Windows PowerShell 5.1** and other shells that do not support `&&`, run them **one line at a time** as shown above (or use `;`)
- After a successful build, the minimum expected outputs are `dist\renderer\index.html`, `dist-electron\main\index.js`, and `dist-electron\preload\index.js`
- For agent-driven setup or troubleshooting, these three manual commands are easier to debug than the one-shot `launch-multicli-discord-bridge.ps1`

### Create desktop shortcuts

If you want a **desktop shortcut** with the app icon, run this once:

```powershell
.\install-shortcuts.cmd
```

You can also do the same through npm:

```powershell
npm run setup:shortcuts
```

The shortcut uses `assets\app-icon.ico` and starts the app through a **single PowerShell launcher that keeps the parent console hidden**. Right after launch, it shows a small startup message window only until the Electron window appears. You can still run `launch-multicli-discord-bridge.ps1` manually for debugging. **It does not register itself in Startup.** If an older shortcut with the same name is still left in Startup, this setup removes it.

If first-time setup fails, prefer running **`npm install` → `npm run build` → `npm start` separately** so you can see exactly which step failed.

## 6. How to use it

1. Start the app
2. The app automatically creates **eight fixed slots**
3. Each slot reconnects to its saved Discord channel
4. If a slot has no channel ID yet, the app auto-creates a Discord channel in the configured guild
5. At startup, the shared artifact channel `terminal-artifacts` is also auto-created or reused
6. On the first launch, the app auto-creates `discord-publish` under terminal 1's working directory
7. Send a normal message to the channel
8. The matching slot terminal / CLI processes the Discord content
9. The result is sent back to Discord
10. Files saved in `discord-publish` are automatically uploaded to the artifact channel on both create and update
11. You can open **Logs** at the top right to inspect startup logs, bridge logs, and terminal input logs inside the app overlay

If a normal text or control request is **still running after 10 seconds**, the bridge sends **one interim terminal screenshot** so you can confirm that the input actually reached the terminal. That interim screenshot also includes a label such as `[inflight screenshot after 10s while running: terminal]` with the currently configured delay. If the request completes within 10 seconds, that interim screenshot is skipped and only the normal reply text plus the configured auto screenshot behavior are used. This feature is **enabled by default** and can be turned off or delayed from Settings and `preferences.json`.

When Discord sends a normal **text or control** request, if the app window is **inactive or minimized**, the bridge makes a best-effort attempt to **restore and bring it to the foreground before** sending terminal input. This foreground activation is not applied to commands such as `!help`, screenshots, or settings changes.

The number of slots is fixed.  
If you rename a workspace, the linked Discord channel name follows that new name.  
Each slot terminal can be restarted with **Restart**.

### Typical slot collaboration flow

- Ask the AI in slot2 to send a review request to slot3
- Read visible text from slot4 to understand what it is doing now
- Add `--notify-on-complete` when the requesting slot needs a completion callback
- Use cron to send a recurring prompt to one specific slot

### Standard feature: AI slot coordination and skill templates

multicli-discord-bridge treats **AI-to-AI slot coordination as a standard feature**.  
The intended workflow is that **an AI uses it through skills**. End users are not expected to operate `slot:send` or `slot:observe` manually in normal use.

While the app is running, a local-only automation endpoint is available for three skill-level actions.

#### The three bundled skill templates

- **`multicli-discord-bridge-slot-send`**  
  A send-only skill for delivering plain text into another slot. It can also omit Enter or request a completion callback, but **completion callbacks stay off by default**.
- **`multicli-discord-bridge-slot-state`**  
  A read-only skill for checking lightweight shared coordination state: `cwd`, `status`, `updatedAt`, `foregroundCommand`, and `recentInbound`.
- **`multicli-discord-bridge-slot-text`**  
  A read-only skill for fetching the **visible text** from a slot when shared state alone is not enough.

The recommended flow is:

1. use the **state skill** to see the overall situation
2. use the **text skill** only for the slots that still need closer inspection
3. use the **send skill** when the AI is ready to hand off or request work

#### How to install them for Copilot

1. Create these three folders:

```text
C:\Users\<your-user>\.copilot\skills\multicli-discord-bridge-slot-send
C:\Users\<your-user>\.copilot\skills\multicli-discord-bridge-slot-state
C:\Users\<your-user>\.copilot\skills\multicli-discord-bridge-slot-text
```

2. Copy the bundled templates from this repo into those folders as `SKILL.md`:

```text
docs\skill-templates\multicli-discord-bridge-slot-send\SKILL.md
docs\skill-templates\multicli-discord-bridge-slot-state\SKILL.md
docs\skill-templates\multicli-discord-bridge-slot-text\SKILL.md
```

3. In each copied file, replace `<repo-path>` with the **local path of your multicli-discord-bridge clone**

They are bundled as templates because users differ in:

- absolute repo path
- Windows username
- which AI CLI they actually run in each slot

#### How to use the skills

After installation, you can ask Copilot in natural language:

- `Send "Review this diff" to slot3`
- `Check the current state of all multiCLI slots`
- `Get the visible text from slot4`
- `Compare slot2 and slot5, then send the request to the better target`
- `Ask slot3 to report back to slot2 when it is done`

The AI can then combine the skills as needed:

- read shared state with the state skill
- inspect visible text with the text skill
- send the actual request with the send skill

That shared state is stored at `%APPDATA%\multicli-discord-bridge\coordination\slot-state.json` and includes each slot's `cwd`, `status`, `updatedAt`, `foregroundCommand`, and `recentInbound`. `foregroundCommand` records only the **first Enter-submitted command after the last `promptReady`**.

#### About the underlying commands

The coordination commands `slot:send` and `slot:observe` are meant to be **internal AI-facing commands**. Most users only need to install the skills and use natural-language requests.

Only if you want to inspect the template internals or the AI-facing command contract, see `docs\ai-slot-coordination.en.md`.

### Common commands

- Normal message: send it directly to the matching slot terminal / CLI
- `!/command`: send `/command` as-is with Enter
- `!noenterTEXT`: send `TEXT` without Enter and do not wait for output
- `!enter`: send Enter only
- `!up` / `!up 3` / `!up3`: send the Up arrow key (1-20 times, default 1, default interval 100ms)
- `!down` / `!down 3` / `!down3`: send the Down arrow key (1-20 times, default 1, default interval 100ms)
- `!left` / `!left 3` / `!left3`: send the Left arrow key (1-20 times, default 1, default interval 100ms)
- `!right` / `!right 3` / `!right3`: send the Right arrow key (1-20 times, default 1, default interval 100ms)
- `!ctrlc`: send Ctrl+C
- `!esc`: send Escape
- `!stop`: send Ctrl+C and try to stop the current request; use Restart if it does not stop
- `!forcestop`: forcibly stop the current terminal and restart it automatically
- `!restartterminal` / `!rst`: restart the matching terminal slot
- `!redraw`: trigger the manual redraw jiggle on the matching terminal slot
- `!restartapp` / `!rsa`: restart the app itself
- `!screenshot` / `!ss`: return a screenshot of the target terminal immediately, even while busy
- `!windowscreenshot` / `!wss`: return a screenshot of the whole app window immediately, even while busy
- `!text 1000` / `!text1000`: return up to the last 1000 visible characters from the current terminal screen
- `!autoscreenshoton`: turn automatic post-reply screenshots on
- `!autoscreenshotoff`: turn automatic post-reply screenshots off
- `!autoscreenshot`: show the current on/off state

If a normal text or control request is **still in progress after the configured delay**, the bridge also sends **one interim terminal screenshot** so you can verify the input state. This is separate from the completion-time auto screenshot and is skipped when the request finishes within the delay. The default is **10 seconds / ON**.
- `!cols`: show the current bridge cols
- `!cols 100`: change the bridge cols
- `!rows`: show the current bridge rows
- `!rows 50`: change the bridge rows
- `!hardtimeout`: show the current hard timeout
- `!hardtimeoutunlimited` / `!hardtimeoutoff`: set hard timeout to unlimited
- `!replyformat`: show the current Discord reply format
- `!replyformatcommand`: switch Discord replies to code block mode
- `!replyformattext`: switch Discord replies to plain text mode

`!text` only accepts `1-9500`, `!cols` only accepts `40-400`, and `!rows` only accepts `15-120`. Out-of-range or non-integer values return an error without changing the setting. In **both normal replies and `!text` replies**, visible text keeps **visual wrap boundaries as line breaks**, repeated symbol runs longer than 5 characters and repeated horizontal whitespace runs longer than 5 characters are compressed down to 5, and line-break runs of 3 or more are compressed down to 2. The requested `!text` count is based on this **post-compression reply length**. Long replies are split using the normal Discord reply chunking rules.

When you attach **Discord files** to a normal message, the app saves them under `AppData\Roaming\...\multicli-discord-bridge\incoming-files\...` and prepends a comment block like this before sending the message to the terminal:

```text
# [DISCORD_ATTACHMENTS_BEGIN]
# file[1]: "C:\...\msg-123\001-report.csv"
# file[2]: "C:\...\msg-123\002-image.png"
# [DISCORD_ATTACHMENTS_END]
```

The original message body follows after that block. Attachments are **saved immediately when received**, grouped under `slot-{n}\YYYY-MM-DD\msg-{messageId}`. A single message allows up to **10 files / 10MB total**, and attachments are rejected on control commands such as `!help`. If a message contains attachments only, the terminal still receives the comment block with **file absolute paths only**. The internal `attachments.json` manifest is kept on disk but is not included in the normal prompt.

The `discord-publish` watcher is **recursive**. It uploads on both new files and updated saves. Temporary files such as `~$`, `.tmp`, `.crdownload`, and `.part`, plus 0-byte files, are ignored. Repeated identical content is de-duplicated by content hash. Successful uploads send **the file only**, while files larger than **10MB** produce an error message in the artifact channel instead.

The middle anchor length for screen diffs now defaults to **300 characters instead of 500**, and can be adjusted from Settings or `preferences.json` through `bridgeSettings.diffAnchorChars`. Shorter anchors make it easier to move the diff start point later, but they also slightly increase the risk of false matches on repetitive screens.

Open Settings from the top right of the Electron app.  
Settings are split into **Global** and **Per slot** sections.

- **Global:** completion text reply on/off, completion text max chars, auto screenshot on/off, Discord reply format, soft timeout / hard timeout, fixed bridge cols / rows (minimum rows is `15`)
- **Global:** Delayed inflight terminal screenshot (default `ON`) and inflight screenshot delay (default `10s`, saved as `bridgeSettings.inflightScreenshotOnRunningRequest` / `bridgeSettings.timing.inflightScreenshotDelaySeconds`)
- **Global:** Artifact publish folder (default is `discord-publish` under terminal 1's cwd, destination channel is the auto-created `terminal-artifacts`)
- **Global:** screen diff anchor chars (default `300`, saved as `bridgeSettings.diffAnchorChars` in `preferences.json`)
- **Global:** bridge timing for redraw/input/Enter/repeat-key waits, plus completion detection, manual redraw, live view publish, screenshot capture, app restart, and attachment download waits/timeouts saved under `bridgeSettings.timing` in `%APPDATA%\multicli-discord-bridge\preferences.json`
- **Per slot:** workspace name, Discord channel ID, that slot's default working directory, and an optional startup command that sends text + Enter exactly once after that slot reaches its first PowerShell prompt during app startup

Default values are:

- Auto screenshot after reply: `ON`
- Completion text reply: `ON`
- Completion text max chars: `5000`
- Delayed inflight terminal screenshot: `ON`
- Discord reply format: `code block`
- Soft timeout: `300s`
- Hard timeout: `unlimited` (the input box shows `7200s`)
- Bridge size: `100 cols x 50 rows`
- Inflight screenshot delay: `10000ms`
- Artifact publish folder: `terminal 1 cwd\discord-publish`
- Screen diff anchor chars: `300`
- Bridge timing: individually adjustable waits for text send, completion settle / no-output / poll, manual redraw, live view publish, screenshot capture, app restart, and attachment download timeout

## Recommended first checks

At first, it is best to start with a safe command like this in an approved channel:

```text
Get-Date
```

If you get a reply, try another lightweight check:

```text
Get-Location
```

## Troubleshooting

### Nothing comes back to Discord

Check these points:

- Is `DISCORD_BOT_TOKEN` correct?
- Does `ALLOW_USER_IDS` contain your user ID?
- Is `ALLOW_GUILD_ID` set to the correct guild ID?
- Can the bot read the channel?
- Did you enable **MESSAGE CONTENT INTENT** in the Discord Developer Portal?

### The app starts but the CLI inside a slot does not behave as expected

- Is PowerShell 7 installed?
- Are execution policies or security restrictions too strict on this PC?
- Can PowerShell itself start normally outside the app?

### Startup fails

- Is Node.js 20 or later installed?
- Try running `npm install` again in the project folder

## Safety notes

- This tool **pipes approved Discord messages into your own PC**
- Do not use it in public servers or channels where many unknown people can post
- Always restrict `ALLOW_USER_IDS`
- Always set `ALLOW_GUILD_ID` and keep it limited to one guild
- Never commit `.env` to Git

## Cron scheduling

While the bridge is running, the built-in cron daemon watches the **repository-local `cron-jobs\` directory**. Dropping JSON files there is enough to schedule a cron start message in the target slot's Discord channel, and that message is then executed through the same bridge path as a normal Discord-origin request. Only when `CRON_JOBS_DIR` is set does it override that default location.

In practice, cron jobs behave like normal Discord sends with the sender replaced by cron, so `!ss`, `!wss`, `!text`, `!stop`, and settings commands follow the same rules. If auto screenshot is enabled for that slot, the completion screenshot reply is attached the same way as a normal Discord request.

Use the bundled TUI to add, edit, delete, and toggle jobs:

#### Run it from inside the repository

```powershell
npm run cron:tui:install   # first time only
npm run cron:tui:start
```

#### Install `mcron`

If you want to launch the cron TUI from **any directory** with `mcron`, run this once from this repository:

```powershell
npm install
npm run cron:tui:install
npm run setup:commands
```

That registers `mcron` as a global command pointing at this clone:

#### Use `mcron`

```powershell
mcron
```

After launch, the cron job list opens and you can control it with:

- `A`: add
- `E`: edit
- `D`: delete
- `Space`: toggle ON / OFF
- `Q`: quit

Other OSS users who clone the repository can enable the same workflow with **clone the repo → `npm install` → `npm run cron:tui:install` → `npm run setup:commands`**. This uses `npm link`, so if the repository is moved to a different path, they should run `npm run setup:commands` again from the new location.

Job file shape (example: `cron-jobs\morning-task.json`):

```json
{
  "name": "morning-task",
  "cron": "0 9 * * *",
  "slot": 2,
  "text": "python analyze.py",
  "timezone": "Asia/Tokyo",
  "active": true
}
```

See `docs/CRON-SPEC.md` for the full cron spec and `docs/public-spec.en.md` for the public summary.

## Public docs

- Japanese README: `README.md`
- Public spec: `docs/public-spec.en.md`
- Japanese public spec: `docs/public-spec.md`
- Changelog: `CHANGELOG.md`

## License

MIT
