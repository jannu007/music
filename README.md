# Akatsuki Synth（暁シンセ）

**完全無料**・**広告なし**・**課金なし**のバーチャルアナログ・シンセサイザー / DTM ワークステーションです。

音は 1 サンプルずつコードで合成しています（サンプル音源・外部オーディオライブラリを一切使用していません）。
そのためライセンス上の制約がなく、**このアプリで作った曲はそのまま商用利用・販売できます**。
アプリ自体も MIT ライセンス相当の自由さでフォーク・再配布・製品化が可能です。

> このリポジトリには、同じ思想（サンプル音源を使わず、その場で音を計算する）で作られた
> **姉妹アプリ**を収録しています。
>
> - 🎹 **[Aozora Grand Piano](PIANO.md)** … 物理モデリング方式のグランドピアノ。
>   `/piano/` で公開、開発時は `npm run piano:dev`
> - 🥁 **[Hibiki Drum Machine](DRUMS.md)** … 14種類の打楽器をその場で合成するドラムマシン。
>   8パターン / ソングモード / ポリメーター / ステム書き出しに対応。
>   `/drums/` で公開、開発時は `npm run drums:dev`
> - 🎸 **[Takibi Guitar](GUITAR.md)** … 物理モデリング方式のギター。指板演奏・コード自動運指・
>   自動伴奏・アンプ／エフェクトまで搭載。`/guitar/` で公開、開発時は `npm run guitar:dev`
> - 🎸 **[Kurogane Bass](BASS.md)** … デジタル導波管方式のエレキベース。指板をタップして演奏でき、
>   スライド・チョーキング・スラップ・フレットレスに対応。
>   `/bass/` で公開、開発時は `npm run bass:dev`
> - 🎤 **[Hoshizora Vocal](VOCAL.md)** … 収録音声（ボイスバンク）を使わない日本語歌声シンセ。
>   かな歌詞をピアノロールに書くだけで歌い、伴奏つきで WAV / MIDI に書き出せます。
>   `/vocal/` で公開、開発時は `npm run vocal:dev`

---

## ハイライト

| | |
|---|---|
| 🎛 **本格アナログ・シンセエンジン** | PolyBLEP によるアンチエイリアス・オシレーター、非線形ムーグ型ラダーフィルター、指数カーブ ADSR を **AudioWorklet** 上で実装。880 Hz のノコギリ波でエイリアス歪み **−40 dB** を実測（自動テストで常時検証）。 |
| 🥁 **モデリング・ドラム音源** | キック／スネア／ハイハット／シンバル等 15 種を合成で生成。Tune / Decay / Tone / Snap / Drive でどこまでも追い込めます。 |
| 🎚 **マルチトラック DAW** | トラックごとに音色・パターン A〜D・ミュート／ソロ／音量／パン。ピアノロールはノートの長さ変更・移動・ベロシティ編集・アンドゥに対応。 |
| 🎼 **ソング構成** | シーンを並べて曲を組み立て（イントロ→Aメロ→サビ…）。パターン再生とソング再生を切り替え可能。 |
| 💾 **プロ品質の書き出し** | **オフラインレンダリング**による 24bit WAV 書き出し（最大 96 kHz）。音切れが原理的に発生せず、実時間より高速。標準 MIDI ファイル書き出しにも対応。 |
| 🎹 **多彩な入力** | 画面上の鍵盤（マルチタッチ・ベロシティ対応）、PC キーボード、**Web MIDI**（ピッチベンド／モジュレーション／サスティンペダル対応）。 |
| 📱 **どこでも動く** | PWA としてスマホのホーム画面に追加でき、オフラインでも動作。Electron で Windows デスクトップアプリ化も可能。 |

---

## 主な機能

### シンセシス・エンジン（AudioWorklet / 自作 DSP）

- **オシレーター ×2**：Saw / Square / Pulse(PWM) / Triangle / Sine / **Super Saw（7ボイス）** / Noise
  - PolyBLEP によるアンチエイリアス処理、オクターブ・半音・デチューン・レベル・スプレッド
- **サブオシレーター**（Sine / Triangle / Square、−1 / −2 オクターブ）
- **ノイズジェネレーター**（ホワイト / ピンク）
- **リングモジュレーション**、**ハードシンク**（サンプル内の正確な位置で位相リセット）、**FM**（OSC2 → OSC1 位相変調）
- **フィルター**
  - `Ladder` … 非線形フィードバック付き 4 ポール・ムーグ型（LPF、粘りのあるアナログ質感）
  - `Clean SVF` … ZDF ステートバリアブル（LPF / HPF / BPF / Notch、12 / 24 dB/oct）
  - カットオフ・レゾナンス・ドライブ・EG 量・キートラック・ベロシティ量
- **エンベロープ ×2**（AMP / FILTER）… アナログ的な指数カーブ ADSR、グラフ表示付き
- **LFO ×2** … 5 波形（S&H 含む）、**テンポ同期**、フェードイン、キーリトリガー
  - 変調先：Pitch / OSC2 Pitch / Pulse Width / Cutoff / Amp / Pan / FM
- **ボイスモード** … Poly（最大16音）/ Mono / Legato、グライド、ベンドレンジ、ベロシティ感度
- **モジュレーションホイール**割り当て（LFO 深さ / カットオフ）

### 音色ライブラリ

BASS / LEAD / PAD / KEYS / PLUCK・BELL / BRASS・STRINGS / SEQ・ARP / SFX / DRUM の
**9 カテゴリー・約 50 音色**を収録。検索・カテゴリー絞り込みに対応し、
編集した音色は「音色を保存」でブラウザ内に永続保存できます。

### シーケンサー

- 16 分音符グリッド（8〜64 ステップ／トラック）、スイング
- トラックごとに **4 つのパターンスロット（A〜D）**、コピー＆ペースト
- ピアノロール：クリックで入力、右端ドラッグで長さ変更、ドラッグで移動、Alt/右クリックで削除、
  下部レーンでベロシティ編集、Ctrl+Z でアンドゥ、ホイールでスクロール、Ctrl+ホイールでズーム
- メトロノーム、タップテンポ、小節：拍のカウンター表示

### エフェクト

- **トラックごと**：ドライブ、コーラス／ディレイ／リバーブへのセンド量
- **常時表示アナライザー**：画面最上部にスペクトラム＋波形と L/R ピークメーター（ピークホールド付き）を常時表示。
  クリックで「波形＋スペクトラム／スペクトラム／波形」を切り替えられます
- **マスター**：ドライブ → 3バンド EQ → コンプレッサー → ブリックウォール・リミッター
- **リバーブ**：初期反射＋指数減衰＋空気吸収モデルの自動生成 IR（Size / Damp / Pre-Delay / Width）
- **ディレイ**：ピンポン、テンポ同期（付点・3連含む）、フィードバック・トーン
- **コーラス**：3 ボイス、位相をずらした LFO、ステレオ幅

---

## クイックスタート

```bash
npm install
npm run dev        # http://localhost:5174/ を開く
```

ブラウザの自動再生制限のため、最初に「スタジオを起動」ボタンを一度クリックしてください。
起動するとすぐに演奏できるデモ曲が読み込まれます（`▶` またはスペースキーで再生）。

### 本番ビルド

```bash
npm run build      # dist/ に出力（静的ファイルのみ）
npm run preview    # ビルド結果をローカルで確認
```

`dist/` をそのまま任意の静的ホスティング（GitHub Pages など）に置けば公開できます。
出力の構成は次のとおりです。

| パス | 内容 |
|---|---|
| `/` | 各アプリへのリンクを並べたランディングページ |
| `/synthesizer/` | **Akatsuki Synth（このシンセ）** |
| `/piano/` `/drums/` `/guitar/` `/bass/` `/vocal/` | 姉妹アプリ |

### 自動テスト（音声の品質検証）

```bash
npm run test       # 型チェック → ビルド → ヘッドレス Chromium で音声を実測
```

`scripts/audio-smoke.mjs` は実際にアプリを起動し、次の項目を検証します。

- アプリ起動・シーケンサーの進行
- ピアノロールのノート追加とアンドゥ
- リアルタイム再生の録音（実際に音が出ているか）
- **オシレーターのエイリアスノイズ**（FFT 解析、−35 dB 以下であること）
- WAV 書き出し（NaN・クリップ・DC オフセット・無音区間・過度なリミッティングの検出）
- MIDI 書き出し、コンソールエラーの有無

---

## スマホで使う（完全無料 / GitHub Pages）

`main` ブランチへの push で GitHub Actions が自動ビルド・公開します
（`.github/workflows/deploy-pages.yml`）。

1. GitHub の **Settings → Pages → Build and deployment** で Source を **GitHub Actions** に設定（初回のみ）
2. `main` に push すると自動で公開されます
   - ランディング … `https://<ユーザー名>.github.io/<リポジトリ名>/`
   - **このシンセ** … `https://<ユーザー名>.github.io/<リポジトリ名>/synthesizer/`
3. スマホのブラウザでシンセの URL を開き「ホーム画面に追加」すればアプリとして起動できます（PWA・オフライン対応）

料金は一切かかりません（パブリックリポジトリの無料枠のみ使用）。

## Windows デスクトップアプリ化（Electron / 無料）

```bash
npm run electron:build   # インストール不要のポータブル exe を生成
npm run electron:dev     # 開発中の確認用
```

---

## 操作のヒント

| 操作 | 内容 |
|---|---|
| **スペース** | 再生 / 停止 |
| **← →** | PC キーボード演奏のオクターブ切替 |
| **Z S X D C V G B H N J M …** | 下段の鍵盤（白鍵／黒鍵） |
| **Q 2 W 3 E R 5 T …** | 上段の鍵盤（1 オクターブ上） |
| **Ctrl + Z** | ピアノロールのアンドゥ |
| **Alt + クリック / 右クリック** | ノート削除 |
| **ノブをダブルクリック** | 初期値に戻す |
| **Shift + ドラッグ** | ノブの微調整 |
| **Ctrl + S** | 曲データを保存 |

作業内容はブラウザに自動保存され、次回起動時に復元されます。

---

## ディレクトリ構成

```
src/
  audio/
    worklets/
      synth-processor.js    ★ DSP コア（オシレーター/フィルター/EG/LFO/ドラム/ボイス管理）
      recorder-processor.js   リアルタイム録音
    AudioEngine.ts          マスターバス・センドFX・IR生成・録音
    Sequencer.ts            トラック／パターン／シーン／スケジューラ
    Arpeggiator.ts          アルペジエーター（ラッチ・スイング対応）
    MidiInput.ts            Web MIDI / PC キーボード入力
    render.ts               オフライン書き出し（バウンス）
    midifile.ts             標準MIDIファイル書き出し
    wav.ts                  WAV(16/24bit) エンコーダ
    presets.ts              ファクトリー音色 + ユーザー音色の保存
    types.ts                パラメータ型定義
  ui/
    App.ts                  画面構成と全体の配線
    SynthPanel.ts           シンセ・パラメーターパネル
    MasterPanel.ts          マスター／エフェクト設定
    PianoRoll.ts            ピアノロール・エディタ（Canvas）
    Mixer.ts                トラック・ミキサー
    SongView.ts             ソング（シーン）エディタ
    PatchBrowser.ts         音色ブラウザ
    Keyboard.ts             バーチャル鍵盤・ホイール
    Visualizers.ts          スコープ／EG／フィルター特性／メーター
    widgets.ts              ノブ・スイッチ等の共通UI
    demoSong.ts             起動時デモ曲
  styles/main.css           スタジオ・ダークテーマ
synthesizer/index.html      シンセの HTML エントリー（/synthesizer/ で公開）
public/index.html           各アプリへのランディングページ（/ で公開）
public/synthesizer/         シンセの PWA マニフェスト・アイコン・Service Worker
scripts/audio-smoke.mjs     音声の自動検証（Playwright）
electron/                   Windows デスクトップアプリ用エントリーポイント
```

姉妹アプリのソースは `src/piano/`（[PIANO.md](PIANO.md)）・`src/drums/`（[DRUMS.md](DRUMS.md)）・
`src/guitar/`（[GUITAR.md](GUITAR.md)）・`src/bass/`（[BASS.md](BASS.md)）・
`src/vocal/`（[VOCAL.md](VOCAL.md)）にあります。
ビルドはまとめて `npm run build` で行われ、`dist/synthesizer/`（シンセ）・`dist/piano/`・
`dist/drums/`・`dist/guitar/`・`dist/bass/`・`dist/vocal/` に出力されます。

---

## 技術的なポイント

- **すべての音声処理を AudioWorklet（オーディオスレッド）で実行**するため、UI 描画や
  ガベージコレクションの影響を受けません。ノートは絶対時刻付きで送られ、レンダークォンタム内の
  サンプル位置に変換して適用されるので、シーケンス再生は**サンプル単位で正確**です。
- **書き出しはオフラインレンダリング**。再生時とまったく同じ音声グラフを `OfflineAudioContext` 上に
  組み直し、全ノートイベントを事前に流し込んで一気にレンダリングします。CPU 負荷による音切れが
  原理的に発生せず、実時間より高速に完了します。
- 内側ループでは**クロージャ生成や分岐を排除**し、変調ルーティングを事前展開しています。

## 技術スタック

- [Web Audio API](https://developer.mozilla.org/ja/docs/Web/API/Web_Audio_API) / [AudioWorklet](https://developer.mozilla.org/ja/docs/Web/API/AudioWorklet)（外部オーディオライブラリ不使用）
- [Web MIDI API](https://developer.mozilla.org/ja/docs/Web/API/Web_MIDI_API)
- [TypeScript](https://www.typescriptlang.org/) / [Vite](https://vitejs.dev/)
- [Electron](https://www.electronjs.org/)（Windows アプリ化・任意）
- [Playwright](https://playwright.dev/)（音声の自動検証・開発時のみ）

## 動作環境

Chrome / Edge / Firefox / Safari（AudioWorklet 対応版）。Windows / macOS / Linux / iOS / Android。

## 今後の拡張アイデア

- サンプラー・トラック（ユーザー音声ファイルの読み込み）
- オートメーション（ノブの時間変化を打ち込み）
- ウェーブテーブル・オシレーター
- MIDI ファイルの読み込み
