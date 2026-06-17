# multicli-discord-bridge Public Specification

**Language:** [日本語](public-spec.md) | English

## 1. Overview

multicli-discord-bridge is an **Electron app for operating PowerShell on a Windows PC from Discord**.  
The app runs locally on the PC, sends Discord messages into PowerShell, and sends the execution result back to Discord.

This project is designed not as a **public remote-management bot**, but as a **bridge tool for operating your own local PC**.

## 2. Intended use cases

- Operate PowerShell on a home PC or local Windows machine through Discord
- Use AI CLIs or interactive CLIs indirectly from Discord
- Monitor both the Discord conversation and the actual terminal screen at the same time

## 3. Supported environment

- OS: Windows
- Terminal: PowerShell
- App type: Electron desktop app
- Discord integration: normal message flow using a bot token

## 4. Basic behavior

### 4.1 Channels and sessions

- The app window shows **eight fixed PowerShell sessions**
- Each pane is a fixed slot, arranged in two rows as `slot1 / slot3 / slot5 / slot7` on top and `slot2 / slot4 / slot6 / slot8` on the bottom
- The runtime model is **1 Discord channel = 1 slot = 1 PowerShell session**
- Messages sent to the same channel go to the same slot session
- If additional text or control input arrives while a reply is still being generated, that input is injected directly into the running session instead of being queued
- The final reply is posted for the first bridge-managed request; intermediate injected inputs do not get their own separate replies
- Messages from non-approved users are ignored
- If a guild restriction is configured, messages from outside that guild are also ignored

### 4.2 Message processing

1. An approved user sends a message to a target channel in the allowed guild
2. The bot receives the message
3. The message is routed to the matching slot's PowerShell session
4. For text or control input, the app window is best-effort restored and brought to the foreground if needed before the message content is sent into PowerShell
5. Changes in the execution result are detected
6. The result is sent back to Discord

### 4.3 Role of the app UI

- The app UI is a **local interface for checking the current session state**
- You can verify from the app whether a Discord message was actually injected
- `!screenshot` / `!ss` returns a **screenshot of the target terminal** to Discord, even while busy, without queueing
- `!windowscreenshot` / `!wss` returns a **screenshot of the whole app window** to Discord, even while busy, without queueing
- `!text N` / `!textN` returns up to the last N characters from the **currently visible terminal text**
- On the first launch, the app automatically creates a `discord-publish` folder under terminal 1's working directory so saved files can be sent to the shared artifact channel
- **Logs** in the top-right header opens an in-app overlay for bridge startup logs, stderr, and terminal input logs
- When started from the desktop shortcut, a temporary startup message window is shown until the Electron window appears

### 4.4 Cron-scheduled sends

- While the bridge is running, the built-in cron daemon watches the **repository-local `cron-jobs\` directory**
- Putting job definitions in `cron-jobs\*.json` posts a cron start message in the target slot's Discord channel and runs that message through the same path as a normal Discord request
- The bundled `bridge-cron-tui` helper can manage those job files
- Setting `CRON_JOBS_DIR` overrides the default `cron-jobs\` location

## 5. Supported inputs

- Normal text message
- `!/command`
- `!noenterTEXT`
- `!enter`
- `!up`
- `!down`
- `!left`
- `!right`
- `!up N`
- `!down N`
- `!left N`
- `!right N`
- `!upN`
- `!downN`
- `!leftN`
- `!rightN`
- `!ctrlc`
- `!esc`
- `!stop`
- `!forcestop`
- `!screenshot`
- `!ss`
- `!windowscreenshot`
- `!wss`
- `!text N`
- `!textN`
- `!restartterminal`
- `!rst`
- `!redraw`
- `!restartapp`
- `!rsa`
- `!autoscreenshoton`
- `!autoscreenshotoff`
- `!autoscreenshot`
- `!cols`
- `!rows`
- `!hardtimeout`
- `!hardtimeoutunlimited`
- `!hardtimeoutoff`
- `!replyformat`
- `!replyformatcommand`
- `!replyformattext`

- Normal text messages can include Discord attachments. When attachments are received, the app prepends a comment block containing only the locally saved **absolute file paths** before passing the body to the terminal
- Attachments are valid only on normal text messages. They are rejected on control commands such as `!help`
- Repeated `!up` / `!down` / `!left` / `!right` inputs support `1-20` presses, with a default send interval of `100ms`
- Files under `discord-publish` are automatically uploaded to the artifact channel on both create and update, and successful uploads send the file only
- If a normal text or control request is still unfinished after the configured delay, the bridge sends one interim terminal screenshot as an additional progress reply together with a delay label such as `[inflight screenshot after 10s while running: terminal]`
- In **both normal replies and `!text` replies**, visible text keeps **visual wrap boundaries as line breaks**, repeated symbol runs longer than 5 characters and repeated horizontal whitespace runs longer than 5 characters are compressed down to 5, and line-break runs of 3 or more are compressed down to 2
- `!text` only accepts integers from `1-9500`, and uses that **post-compression reply length** before normal reply chunking is applied
- Separate from Discord, a **standard AI slot-coordination feature** accepts AI-facing `slot + from + text + optional Enter` sends through a local-only automation endpoint, activating the target slot in the app before sending and automatically prepending a `[from: ...]` header
- Those sends now return a lightweight **delivery likelihood check** with `likely_delivered`, `uncertain`, or `likely_not_delivered`
- Those sends can also opt into a sender-slot task-complete callback with `notifyOnComplete`, but the default stays **off**, including skill-driven sends
- Only when AI coordination or user confirmation requires it, local automation can also fetch coordination slot-state JSON, visible slot text, slot screenshots (`!ss` equivalent), and an app window screenshot (`!wss` equivalent)

## 6. Safety-related behavior

- The bot starts only when `DISCORD_BOT_TOKEN` is set
- Allowed users are restricted by `ALLOW_USER_IDS`
- `ALLOW_GUILD_ID` is required and restricts operation to **exactly one** guild
- The local automation endpoint is available only while the Electron app is running and is mainly intended for AI skills. `--from` is required and the delivered text automatically gets a `[from: ...]` header. For the AI-facing contract, see `docs\ai-slot-coordination.en.md`; for bundled templates, see `docs\skill-templates\`
- Delayed inflight screenshots are enabled by default and can be changed in seconds through `preferences.json` with `bridgeSettings.inflightScreenshotOnRunningRequest` and `bridgeSettings.timing.inflightScreenshotDelaySeconds`
- If you use automatic slot/artifact channel creation or channel renaming, the bot needs the Discord **Manage Channels** permission
- Each slot stores its Discord channel ID and reconnects to the same channel after restart
- If a slot has no channel ID, the app auto-creates a Discord channel at startup or when settings are saved
- The shared artifact channel `terminal-artifacts` is also auto-created or reused at startup
- Even while a bridge-managed session is running, additional normal input can still be sent from the local UI or Discord
- Automatic post-reply screenshots can be turned on or off from the Electron settings UI or Discord commands
- Discord reply format, completion text max chars, soft timeout / hard timeout, and fixed bridge dimensions can be changed from the Electron settings UI
- The screen diff middle anchor length can also be changed from the Electron settings UI or `preferences.json`, and defaults to `300`
- The artifact publish folder can be changed from the Electron settings UI and is stored in `preferences.json`
- In addition to redraw waits, snapshot waits, text-to-Enter waits, and repeated-key intervals, completion detection, manual redraw, live view publish, screenshot capture, app restart, and attachment download timeouts can also be changed from the Electron settings UI and are stored in `preferences.json`
- Bridge cols / rows can also be changed from the `!cols` / `!rows` commands
- Each slot's default working directory can be changed from the Electron settings UI

## 7. Current limitations

- Windows only
- PowerShell only
- Assumes normal Discord messages, not slash commands
- Not intended for public channels with many unspecified participants
- Multiple shell support, fine-grained permissions, and full TUI compatibility are not supported yet

## 8. Not supported / out of scope

- Linux / macOS support
- Official support for cmd / bash / zsh / WSL
- Advanced role-based permission management
- Complex session operations based on Discord threads
- SaaS / cloud service hosting

## 9. Configuration items

Minimum required settings:

```env
DISCORD_BOT_TOKEN=...
ALLOW_USER_IDS=...
ALLOW_GUILD_ID=...
```

## 10. Notes

- `.env` is loaded automatically when the app starts
- Older keys such as `DISCORD_ALLOWED_USER_ID` and `DISCORD_ALLOWED_GUILD_IDS` are still accepted for compatibility, but guild-side config must still resolve to exactly one guild ID
- See `README.en.md` for full setup instructions

## 11. Fixed eight-slot layout

- There is no left sidebar; the main app uses a fixed 4-column by 2-row eight-slot layout
- Each pane title bar shows the slot status and a Restart action
- Settings opens from the top-right header as a separate overlay
- Logs opens from the top-right header in the same overlay style as Settings
- The settings UI separates Global settings from Per slot settings
- The default Global settings are `auto screenshot ON`, `code block` replies, `soft timeout 300s`, `hard timeout unlimited`, `100x50` bridge size, plus the default wait values for bridge timing / completion / screenshot / download
- The default delayed inflight screenshot setting is `ON`, with a `10000ms` delay
- The default artifact publish settings are `discord-publish` under terminal 1's working directory and the shared channel `terminal-artifacts`
- The default screen diff middle anchor length is `300`
- Global bridge rows must be set to `15` or higher
- If a workspace name changes, the linked Discord channel name changes with it
