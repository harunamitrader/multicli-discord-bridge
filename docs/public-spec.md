# multicli-discord-bridge 公開仕様書

**Language:** 日本語 | [English](public-spec.en.md)

## 1. 概要

multicli-discord-bridge は、**Windows PC 上の PowerShell を Discord から操作するための Electron アプリ**です。  
アプリ本体はローカル PC で動作し、Discord 側のメッセージを PowerShell に送り、その実行結果を Discord に返します。

このプロジェクトは、**リモート管理用の一般公開 bot** ではなく、**ローカル PC を自分で操作するための bridge ツール**として設計されています。

## 2. 想定ユースケース

- 自宅 PC や手元の Windows マシンで PowerShell を Discord 経由で操作したい
- Discord 上から AI CLI や対話型 CLI を間接的に使いたい
- Discord のやり取りと、実際のターミナル画面の両方を確認しながら運用したい

## 3. 対応環境

- OS: Windows
- ターミナル: PowerShell
- アプリ形式: Electron デスクトップアプリ
- Discord 連携: Bot トークンを使った通常メッセージ連携

## 4. 基本動作

### 4.1 チャンネルとセッション

- アプリ画面には **8固定の PowerShell セッション** を表示します
- 各 slot は固定で、レイアウトは上段が `slot1 / slot3 / slot5 / slot7`、下段が `slot2 / slot4 / slot6 / slot8` の 2 段構成です
- **1 Discord チャンネル = 1 slot = 1 PowerShell セッション** の対応で運用します
- 同じチャンネルに送ったメッセージは、同じ slot のセッションへ送られます
- 応答生成中に追加の text / control 入力が来た場合は、キューせず実行中セッションへそのまま流し込みます
- 応答返信は最初の bridge-managed リクエストに対して返し、途中の追加入力自体には個別返信しません
- 許可されていないユーザーのメッセージは無視されます
- guild 制限を設定した場合は、その guild 外のメッセージも無視されます

### 4.2 メッセージ処理

1. 許可済みユーザーが、対象 guild 内のチャンネルにメッセージを送る
2. Bot がそのメッセージを受信する
3. 対応する slot の PowerShell セッションへルーティングする
4. text / control 入力なら、必要に応じてアプリウィンドウを best-effort で復元・前面化してからメッセージ内容を PowerShell に送る
5. 実行結果の変化を検出する
6. 結果を Discord に返信する

### 4.3 アプリ画面の位置づけ

- アプリ画面は **現在のセッション状態を確認するためのローカル UI** です
- Discord から送った内容が実際に投入されたか、アプリ側でも確認できます
- `!screenshot` / `!ss` を送ると、**対象 terminal のスクリーンショット**が Discord に返信されます（busy 中もキューせず、その時点の terminal 画面を返します）
- `!windowscreenshot` / `!wss` を送ると、**アプリ画面全体のスクリーンショット**が Discord に返信されます（busy 中もキューせず、その時点の app 画面を返します）
- `!text N` / `!textN` を送ると、**現在表示中の terminal テキスト末尾**を最大 N 文字まで Discord に返信します
- 初回起動時は terminal 1 の working directory 直下に `discord-publish` フォルダを自動作成し、保存ファイルを共通 artifact チャンネルへ送れます
- ヘッダー右上の **Logs** から、bridge の起動ログ・stderr・terminal 入力ログをアプリ内オーバーレイで確認できます
- デスクトップショートカット起動時は、Electron ウィンドウが表示されるまで一時的な起動メッセージウィンドウを出します

### 4.4 Cron スケジュール送信

- Bridge 起動中は、内蔵の cron デーモンが **リポジトリ直下の `cron-jobs\`** を監視します
- `cron-jobs\*.json` にジョブ定義を置くと、指定した時刻に対象 slot の Discord チャンネルへ cron 開始メッセージを出し、そのメッセージを通常の Discord 送信と同じ経路で実行します
- ジョブ管理には、repo 同梱の `bridge-cron-tui` を使えます
- `CRON_JOBS_DIR` を設定した場合だけ、既定の `cron-jobs\` 保存先を上書きできます

## 5. 対応している入力

- 通常のテキストメッセージ
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

- 通常テキストメッセージでは Discord 添付ファイルも受け付け、受信時にローカル保存した**ファイルの絶対パスだけ**をコメントブロックとして本文先頭に付けて terminal へ渡します
- 添付は通常テキスト時のみ有効で、`!help` などの制御コマンドに添付した場合は拒否されます
- `!up` / `!down` / `!left` / `!right` の連続入力は `1-20` 回で、送信間隔の初期値は `100ms` です
- `discord-publish` 配下のファイルは、新規作成だけでなく更新保存時にも artifact チャンネルへ自動添付送信され、成功時はファイルだけを送ります
- 通常の text / control リクエストが設定した delay 以上完了しない場合は、その時点の terminal スクリーンショットを途中確認用に 1 回だけ追加返信し、`[inflight screenshot after 10s while running: terminal]` のような設定秒数付きラベルも返します
- **通常返信と `!text` 返信の両方**で、visible text の **visual wrap 改行位置を維持**したまま、同じ記号の 5 文字超連続・横方向空白の 5 文字超連続は 5 文字まで、改行の 3 回以上連続は 2 回までに圧縮されます
- `!text` は `1-9500` の整数だけ受け付け、指定文字数はその圧縮後の返信テキスト長ベースで扱い、必要なら通常の reply chunking で分割します
- Discord とは別に、**標準の AI slot 連携機能**として、ローカル専用 automation endpoint から AI skill 向けの `slot + from + text + optional Enter` 送信を受け付けます。送信前には対象 slot をアプリ側でアクティブ化し、送信時には `[from: ...]` ヘッダーを自動付与します
- その送信は既定で数秒後の **delivery likelihood check** を返し、`likely_delivered / uncertain / likely_not_delivered` の 3 値で軽く確認できます
- その送信は、必要な場合だけ `notifyOnComplete` で送信元 slot への task complete 通知を opt-in できます。**既定は OFF で、skill 経由でも自動では有効になりません**
- AI 連携やユーザー確認が必要なときだけ、local automation から slot coordination state JSON、slot visible text、slot screenshot (`!ss` 相当)、app window screenshot (`!wss` 相当) を取得できます

## 6. 安全性に関する仕様

- Bot は `DISCORD_BOT_TOKEN` が設定されているときだけ起動します
- 許可ユーザーは `ALLOW_USER_IDS` で制限します
- `ALLOW_GUILD_ID` で対象 guild を **必ず 1 つ** 指定します
- ローカル automation endpoint は Electron アプリ起動中のみ利用でき、主に AI skill から使う前提です。`--from` は必須で、送信時は `[from: ...]` ヘッダーを自動付与します。AI 向け仕様は `docs\ai-slot-coordination.md`、同梱 template は `docs\skill-templates\` を参照してください
- 途中確認用の delayed inflight screenshot は既定で ON で、`preferences.json` の `bridgeSettings.inflightScreenshotOnRunningRequest` と `bridgeSettings.timing.inflightScreenshotDelaySeconds` で秒単位に変更できます
- slot / artifact channel の自動作成・名前更新を使う場合、Bot には Discord 側で **Manage Channels** 権限が必要です
- 各 slot は保存された Discord channel ID を持ち、再起動後も同じ channel に紐づき続けます
- slot の channel ID が空なら、起動時または設定保存時に Discord channel を自動作成します
- artifact 送信用の共通 channel `terminal-artifacts` も起動時に自動作成または再利用します
- 処理中の bridge-managed session に対しても、ローカル UI 側や Discord 側から通常入力を追加できます
- 自動スクリーンショット送信は Electron アプリ側設定または Discord コマンドで ON / OFF できます
- Discord 返信形式、完了時テキスト最大文字数、soft timeout / hard timeout / fixed bridge dimensions は Electron アプリ側設定で変更できます
- screen diff の中間アンカー長も Electron アプリ側設定または `preferences.json` で変更でき、既定値は `300` です
- artifact publish folder も Electron アプリ側設定で変更でき、設定は `preferences.json` に保存されます
- bridge timing（再描画後待機、snapshot 前待機、text-to-Enter、連続キー間隔）に加えて、completion 判定、manual redraw、live view publish、screenshot capture、app restart、attachment download timeout も Electron アプリ側設定から変更でき、`preferences.json` に保存されます
- bridge cols / rows は `!cols` / `!rows` コマンドからも変更できます
- 各 slot の default working directory は Electron アプリ側設定で変更できます

## 7. 現在の制限

- Windows 専用です
- PowerShell 専用です
- slash command ではなく通常メッセージ前提です
- 不特定多数が参加する公開チャンネルでの利用は想定していません
- 複数シェル対応、細かな権限管理、完全な TUI 互換は未対応です

## 8. 非対応・対象外

- Linux / macOS 対応
- cmd / bash / zsh / WSL の正式サポート
- 複数ロールに応じた高度な権限管理
- Discord スレッド単位の複雑なセッション運用
- SaaS / クラウドサービスとしての提供

## 9. 設定項目

最低限必要な設定:

```env
DISCORD_BOT_TOKEN=...
ALLOW_USER_IDS=...
ALLOW_GUILD_ID=...
```

## 10. 補足

- `.env` はアプリ起動時に自動読み込みされます
- 旧形式の `DISCORD_ALLOWED_USER_ID` / `DISCORD_ALLOWED_GUILD_IDS` も互換のため読み取れますが、guild 側は最終的に 1 件に解決される必要があります
- 詳しい導入方法は `README.md` を参照してください

## 11. 固定8スロットレイアウト

- 左サイドバーはなく、アプリ本体は 4列2段の固定 8 slot レイアウトです
- 各枠のタイトルバーに、その枠の状態表示と Restart 操作があります
- 設定はヘッダー右上の Settings から別画面で開きます
- Logs もヘッダー右上から Settings と同様のオーバーレイで開きます
- 設定画面では、Global 設定と Per slot 設定を分けて管理します
- Global 設定の初期値は、`auto screenshot ON`、`code block` 返信、`soft timeout 300s`、`hard timeout unlimited`、`100x50` bridge サイズ、`bridge timing` / completion / screenshot / download 系の既定待機値です
- delayed inflight screenshot の初期値は `ON`、delay は `10000ms` です
- artifact publish の初期値は、terminal 1 の working directory 直下の `discord-publish` と共通チャンネル `terminal-artifacts` です
- screen diff 中間アンカー長の初期値は `300` です
- Global 設定の bridge rows は `15` 以上で設定します
- ワークスペース名を変更した場合は、対応する Discord チャンネル名も追従して変更されます
