# Changelog

このファイルは、このプロジェクトの公開向け更新履歴を記録します。

## [Unreleased]

### Added

- Per-slot startup command settings to auto-send text + Enter once after each slot reaches its first PowerShell prompt during app startup
- 連携時だけ読む shared state として、各 slot の `cwd` / `status` / `updatedAt` / `foregroundCommand` / `recentInbound` を `%APPDATA%\multicli-discord-bridge\coordination\slot-state.json` に記録する仕組み
- `slot:observe -- --state` と `slot:observe -- --slot slotN --state` による coordination state 読み取り
- Copilot 用の `multicli-discord-bridge-slot-state` skill テンプレート
- Copilot 用の `multicli-discord-bridge-slot-text` skill テンプレート
- AI slot 連携の標準機能ドキュメント `docs\ai-slot-coordination.md` / `docs\ai-slot-coordination.en.md`
- 6固定 slot を 1 ウィンドウ内で表示し、右側に slot5 / slot6 用の半幅列を追加
- `slot:send` に、`[from: ...]` ヘッダー付きの送信元ラベルを付ける仕組み
- `!rst` / `!rsa` / `!ss` / `!wss` の省略コマンド
- `!hardtimeout`, `!hardtimeoutunlimited`, `!hardtimeoutoff` コマンド
- `!cols`, `!rows` で bridge dimensions を確認・変更するコマンド
- Settings / `preferences.json` で bridge timing に加えて completion / screenshot / restart / attachment download timeout も調整できる設定項目
- text / control 完了時の Discord 差分テキスト返信を Settings / `preferences.json` から ON/OFF できる設定項目
- text / control 完了時の Discord 差分テキスト最大文字数を Settings / `preferences.json` から変更できる設定項目
- cron ジョブ送信先 slot の対応を 1〜8 に拡張し、同梱 `bridge-cron-tui` と `docs\CRON-SPEC.md` も同じ上限に統一
- `!up`, `!down` で矢印キーを送るコマンド
- `!up N`, `!down N` と `!upN`, `!downN` の連続矢印キーコマンド
- `!left`, `!right`, `!left N`, `!right N`, `!leftN`, `!rightN` の左右矢印キーコマンド
- `!replyformat`, `!replyformatcommand`, `!replyformattext` コマンド
- `!redraw` で Discord から terminal の手動再描画 jiggle を実行するコマンド
- `!text N`, `!textN` で現在表示中の terminal テキスト末尾を最大 9500 文字まで返信するコマンド
- 通常返信と `!text` 返信で visual wrap の改行位置を維持する動作
- delayed inflight screenshot のラベルに設定秒数を含め、settings / `preferences.json` 側も秒単位で扱う変更
- 起動完了後と `!rsa` による再起動後に、slot1 の Discord チャンネルへ bridge ready メッセージを送る動作
- `!/command` と `!noenterTEXT` の入力モード切り替え
- アプリ内 terminal で `Ctrl+V` によるクリップボードテキスト貼り付け
- AI 間連携の標準機能として、ローカル automation endpoint と `slot:send` / `slot:observe` ベースの skill テンプレート
- 通常の text / control リクエストが delay 以上完了しないときに、途中確認用の terminal スクリーンショットを 1 回返す動作（既定 ON / delay 設定可）
- Discord 返信形式の `code block` / `plain text` 切り替え
- hard timeout の unlimited 設定
- busy 中の `!ss` / `!wss` をキューせず即時キャプチャする動作
- `discord-publish` 監視フォルダの新規作成・更新ファイルを共通 artifact チャンネルへ自動添付送信する動作
- screen diff の中間アンカー長を 500 文字から 300 文字へ変更し、設定ファイルからも調整できる項目
- fallback 返信使用時の `[reply fallback used]` マーカー
- terminal slot 再起動とアプリ再起動の Discord コマンド
- アプリ内で main process ログと terminal 入力ログを確認できる Logs オーバーレイ
- デスクトップショートカット向けの単一 PowerShell launcher
- デスクトップショートカット起動中に出す一時的な起動メッセージウィンドウ
- Cron ジョブ管理用の `bridge-cron-tui` を repo 同梱サブディレクトリとして追加
- 6 slot ワークスペースに、内部 terminal サイズは変えず表示ペイン比率だけを変える draggable divider

### Changed

- slot 数を 6 から 8 に拡張し、固定レイアウト・Settings・slot send/observe 系の対応範囲を `slot1-slot8` に変更
- 6 slot の表示順と Settings 内の Per slot 表示順を、左列 `slot1 / slot2`・中央列 `slot3 / slot4`・右列 `slot5 / slot6` に変更
- `multicli-discord-bridge` の Copilot skill 同梱を `docs\skill-examples` から `docs\skill-templates` に整理し、send / state / text の 3 分割に変更
- `multicli-discord-bridge-slot-send` skill は送信専用とし、連携判断は state skill、visible text 取得は text skill を使う前提に整理
- ローカル UI の pane / settings 表記を `P1` 形式から `slot1` 形式へ変更
- ローカル AI / shell、skill、cron の slot 対応範囲を `slot1-slot6` に拡張
- `slot:send` の `--from` を必須化し、skill では本文冒頭の短い名乗りと sender slot 確認ルールを使うよう変更
- 起動メッセージウィンドウは signal 削除に加えて Electron のメインウィンドウ表示でも自動終了するよう変更
- アプリウィンドウの最小サイズを `1240x680` に調整
- 返信抽出を、再描画後に取得した before/after `screenText` ベースへ変更
- 通常返信・`!text` 返信・fallback 返信で、連続改行は 2 回まで、その他の装飾的な連続記号や横空白は 5 文字までに圧縮するよう変更
- ローカル AI / shell からの `slot:send` / local automation 送信でも、対象 slot をアクティブ化してから入力するよう変更
- `slot:send` / local automation に、既定 OFF・skill でも自動 ON しない送信元 slot 向け task complete 通知オプションを追加
- Cron ジョブ定義の既定保存先をユーザーホーム配下から repo 内の `cron-jobs\` に変更
- busy 中の Discord text/control 入力は、キューせず実行中セッションへ直接送る仕様に変更
- busy 中でもローカル UI から入力できるよう変更
- 通常の text 送信前待機を延長し、before-send 再描画後・snapshot 後・Enter 前の各間隔を広げて Copilot/TUI への入力反映を待ちやすく変更
- Discord からの text / control 入力前には、アプリウィンドウが非アクティブまたは最小化なら best-effort で復元・前面化してから送るよう変更
- Cron ジョブ実行は、対象 slot の Discord チャンネルに開始メッセージを出して通常の Discord リクエスト経路へ流すよう変更し、reply / busy passthrough / auto screenshot を共通化
- Settings の Global セクションを機能別グループに整理し、説明文を English に統一
- interactive CLI の完了判定は、Gemini 固有の TUI マーカーではなく汎用の prompt / output / idle 信号を優先するよう変更
- hard timeout 到達時は自動リセットせず、timeout 応答だけ返す仕様に変更
- Settings の timeout 表示単位を ms から s に変更
- グローバルの default working directory 設定を廃止
- 各 terminal の working directory 表記を `Default working directory` に変更
- 初期設定を `auto screenshot ON`、`code block`、`soft timeout 300s`、`hard timeout unlimited`、`100x50` に変更
- デスクトップショートカットは親コンソールを表示しない単一 PowerShell launcher を使うよう変更
- Discord 添付ファイルを terminal に渡すコメントブロックは、manifest や count を含めずファイルパスのみの簡略形式に変更
- bridge rows の最小値を `15` に変更

### Fixed

- Discord 返信に Copilot CLI の進捗再描画行が混ざりやすい経路を縮小
- TUI の再描画で Discord 返信差分が広がりすぎるケースを、500文字アンカー探索と小さめ fallback で抑制
- `discord-publish` に新規ファイルを入れたとき、既存で未変更のファイルまで一緒に送られることがある問題を修正

## [0.1.0] - 2026-05-10

### Added

- Discord から PowerShell セッションへ入力を送る bridge 機能
- 1 Discord チャンネル = 1 セッションの基本運用
- アプリ画面全体を Discord に返すスクリーンショット機能
- 返信完了後にアプリ画面スクリーンショットを自動送信する設定
- `!enter`, `!ctrlc`, `!esc`, `!stop`, `!screenshot` コマンド
- `!autoscreenshoton`, `!autoscreenshotoff`, `!autoscreenshot` コマンド
- 4つの固定 slot ごとの Discord チャンネル自動作成と自動紐づけ
- 全体既定のワークスペースディレクトリ設定
- 各 slot のワークスペース名設定と Discord チャンネル名追従リネーム
- 2x2 の 4固定 PowerShell レイアウト
- 右上 Settings から開く専用設定画面
- 各固定 terminal ごとの channel ID / workspace 名 / cwd 設定
- タブ close 時の確認ダイアログ
- アプリ終了時の確認ダイアログ
- 日本語 README
- 公開向け仕様書 `docs/public-spec.md`
- `LICENSE`
- `.env.example`
- `CONTRIBUTING.md`

### Changed

- プロジェクト名を `multicli-discord-bridge` に変更
- UI 上の不要なボタンを整理
- リネーム UI をアプリ内編集に変更
- `.env` をアプリ起動時に自動読み込みするよう改善
- 許可ユーザー / guild 制限の環境変数に後方互換を追加
- `ALLOW_GUILD_ID` を単一必須に変更し、複数 guild への広域反応を防止
- bridge の soft timeout / hard timeout / fixed dimensions をアプリ設定へ移動
- `npm link` ベースでどこからでも起動できる global `mcron` command を追加
- guild 設定を単一 `ALLOW_GUILD_ID` ベースに整理
- 左サイドバー UI を廃止し、固定4枠レイアウトと各 terminal のタイトルバー操作へ移行

### Fixed

- Discord -> Electron -> Gemini / PowerShell 送信時の false completion 問題を修正
- テキスト送信時に入力だけ残って実際には submit されない問題を修正
