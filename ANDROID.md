# Android 版のつくり方（完全オフライン同梱）

> **販売までの手順は [PLAY.md](PLAY.md) にまとめました。**
> こちらは、アプリの中身をどう作っているかの説明です。

Google Play の「ウェブ表示スパム」ポリシーで停止されたのは、アプリが
**TWA（web サイトを包んだだけのアプリ）** だったためです。中身が
`jannu007.github.io` にあり、そのドメインは GitHub の所有物なので、
Google からは「開発者が所有を証明できないサイトへ誘導するアプリ」に見えます。

ここでは **web サイトを一切参照しない** 作り方に切り替えます。
ビルド済みのファイルを丸ごと APK に入れてしまうので、
「サイトへ誘導する」という指摘の前提そのものが無くなります。

---

## なぜ `file://` ではないのか

このアプリ群は音源をすべて **AudioWorklet** で合成しています。
AudioWorklet は**セキュアコンテキストでしか動きません**。`file://` は
セキュアコンテキストではないため、単純にファイルを置くだけでは
**音がまったく出ません**。

そこで Capacitor を使い、端末内のファイルを `https://localhost` から
配る形にしています（`androidScheme: 'https'`）。通信は端末の中で完結し、
外には一切出ません。

---

## 手順

### 1. バンドルを作る

```bash
npm ci
npm run native:build
```

`dist-native/<アプリ名>/` に、アプリごとの自己完結したフォルダができます。

| アプリ | パッケージ名 | 容量 |
| --- | --- | --- |
| synthesizer | `shop.youkoku.synth` | 約 0.97 MB |
| piano | `shop.youkoku.piano` | 約 1.11 MB |
| drums | `shop.youkoku.drums` | 約 1.04 MB |
| guitar | `shop.youkoku.guitar` | 約 1.16 MB |
| bass | `shop.youkoku.bass` | 約 1.10 MB |
| vocal | `shop.youkoku.vocal` | 約 1.16 MB |
| sampler | `shop.youkoku.sampler` | 約 1.09 MB |

Service Worker（`sw.js`）は同梱していません。ファイルが端末内にある以上
キャッシュ層は不要で、あると更新の邪魔になるためです。同梱版の
`index.html` には `window.__NATIVE_BUNDLE__` が埋め込まれていて、
本体はこれを見て Service Worker の登録を飛ばします（web 版では従来どおり登録します）。

### 2. オフラインで完結しているか確認する

```bash
npm run native:verify
```

各アプリを配信したうえで **localhost 以外への通信をすべて遮断**し、
AudioWorklet が読めるか・音が出るか・外部を1つも見ていないかを検査します。
1つでも外部を参照していればここで失敗します。

### 3. Android プロジェクトを作る（アプリごとに1回だけ）

```bash
cd native/drums          # 作りたいアプリのフォルダ
npx cap add android
```

`native/<アプリ名>/capacitor.config.json` は `npm run native:build` が
自動生成しています（パッケージ名・アプリ名・バンドルの場所が入っています）。

### 4. 以降、更新のたびに

```bash
npm run native:build
cd native/drums && npx cap sync android
```

### 5. ビルドと署名

```bash
cd native/drums && npx cap open android
```

Android Studio で **Build → Generated Signed Bundle / APK** から
`.aab` を作り、Play Console にアップロードします。

---

## Play への再申請メモ

- **`assetlinks.json` はもう使いません。** TWA をやめるので、
  `public/.well-known/assetlinks.json` の 6 パッケージぶんの記述
  （`handle_all_urls` の委譲）は不要です。残しておくと「このアプリ群は
  あのサイトのラッパーである」と宣言し続けることになるため、
  再申請の前に削除することをおすすめします。
- **異議申し立ての書き方。** 停止メールは「第三者コンテンツの使用許諾書を出せ」
  という前提で書かれていますが、今回はすべて自作のコンテンツなので
  その様式は当てはまりません。次の点を伝えてください。
  - アプリの音源・UI・アイコン・デモはすべて自作で、第三者の著作物を含まないこと
  - 新しいバージョンは web サイトを一切参照せず、すべての機能が端末内で完結すること
    （機内モードで全機能が動作します）
- **6本を1本にまとめることも検討の価値があります。** ほぼ同じアプリが
  複数並んでいること自体がスパム判定を強める材料になります。
  6つの楽器を1つのアプリにまとめれば、その材料が消えます。

---

## ファイルの書き出しについて

web 版は `<a download>` でブラウザに任せていますが、**Android の WebView では
この方法がまったく効きません**。Capacitor は WebView に `DownloadListener` を
設定しないため、`blob:` を指したダウンロードは例外も出さずに捨てられます。
書き出し自体は成功して「WAV exported (9.7 MB)」と出るのに、ファイルがどこにも
無い——という状態になります。

そこで同梱アプリでは、Capacitor のブリッジ越しに Filesystem プラグインで
端末へ直接書き込み、そのあと共有シートを開いて保存先を選べるようにしています
（`shared/download.ts`）。共有シートを閉じても、ファイルは端末に残ります。

保存先は上から順に試します。

| 順 | 場所 | 備考 |
| --- | --- | --- |
| 1 | ドキュメント | ファイルアプリからすぐ見つかる |
| 2 | `Android/data/<パッケージ>/files` | 権限が要らず必ず書ける |
| 3 | 一時フォルダ | 最後の砦。共有シートから救い出せる |

10 MB 級の WAV を一度にブリッジへ渡すと重いので、768KB ずつ分割して
`writeFile` → `appendFile` と継ぎ足しています（base64 は3バイト単位なので、
境界を3の倍数にそろえないと中身が壊れます）。

この経路は `npm run test:download` で検査しています。実機を使わずに、
ネイティブへ渡している内容が元のバイト列と一致するかまで確認できます。

なお **読み込み（プロジェクトを開く）は WebView でもそのまま動きます**。
Capacitor が `onShowFileChooser` を実装しているためで、壊れていたのは書き出しだけです。

### ビルド時の注意

Capacitor はプラグインを **`package.json` の dependencies から探します**。
`npm install --no-save` で入れると、`node_modules` に在っても「プラグインが無い」と
判断され、**ファイルの書き出しができない APK** ができあがります。
ワークフローでは保存して入れ、`capacitor.plugins.json` に載ったかどうかを
ビルド中に確認しています。

---

## 動作確認のポイント（実機）

1. **機内モードにしてから**アプリを起動する
2. 音が出ること（AudioWorklet がセキュアコンテキストで動いている証拠）
3. WAV / MIDI の書き出しができること
   （書き出すと共有シートが開き、状態表示に保存先が出ます）
4. 保存したファイルをファイルアプリの「ドキュメント」で開けること
5. URL バーやブラウザの UI がどこにも出ないこと

---

## 署名鍵（キーストア）とは何か

Play にアップロードする `.aab` には、**署名**が要ります。

署名鍵は、印鑑のようなものです。アプリを更新するとき、Play は
「前と同じ印鑑が押してあるか」を見ます。同じでなければ、
別人が成りすまして更新しようとしている、と見なして拒否します。

だから鍵は

- **自分で作って、自分で持つ**もの（Google も、私も、代わりに持てません）
- **失うと、そのアプリは二度と更新できなくなる**もの

です。作るのは一度きりで、7本すべてに同じ鍵を使えます。

> 鍵ファイルとパスワードを、このやりとりに貼らないでください。
> 登録は、あなたの手元から GitHub へ直接お願いします。

---

## 鍵をつくる（スマホだけで完結します）

### いちばん簡単な方法

1. **Termux** をインストールします（F-Droid 版を推奨。Play 版は更新が止まっています）
2. Termux を開き、次の1行を貼り付けて実行します

```bash
bash <(curl -sL https://raw.githubusercontent.com/jannu007/music/main/scripts/make-upload-key.sh)
```

聞かれるのは2つだけです。

| 聞かれること | 答え方 |
| --- | --- |
| 組織名 | そのまま Enter で `Youkoku` になります |
| パスワード | 決めて入れるか、**空 Enter で自動生成**（強いものが出ます） |

終わると、GitHub に登録する4つの値が表示されます。
`ANDROID_KEYSTORE_BASE64` は、そのままクリップボードにも入ります。

> **パスワードに日本語は使えません。** Java が受け付けず、途中で止まります。
> スクリプトは入れた時点で教えてくれますが、覚えておくと安心です。

### 自分で打つ場合

```bash
pkg install openjdk-17

keytool -genkeypair -v \
  -keystore upload.jks -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storetype PKCS12

# 登録用の文字列にする
base64 -w0 upload.jks
```

パソコン（Windows / Mac）でも、Java が入っていれば同じコマンドで作れます。

---

## GitHub に登録する

リポジトリ → **Settings** → **Secrets and variables** → **Actions**
→ **New repository secret** を4回。

| 名前 | 中身 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 upload.jks` の出力（3,000字ほどの長い文字列） |
| `ANDROID_KEYSTORE_PASSWORD` | 決めたパスワード |
| `ANDROID_KEY_ALIAS` | `upload` |
| `ANDROID_KEY_PASSWORD` | 決めたパスワード（上と同じ） |

登録できたかは、ビルドを回すと分かります。ログの最後に

```
署名: あり
```

と出れば成功です。「なし」なら、どれかが入っていません。

---

## 必ず控えを取ってください

`upload.jks` とパスワードを失うと、**そのアプリは二度と更新できません**。
Google にも復元してもらえません。

- 鍵ファイルを、Google ドライブなど**別の場所**に保存する
- パスワードを、パスワード管理アプリに保存する

**GitHub の Secrets は控えになりません。** 登録したあとは中身を読み出せない
仕組みだからです。必ず別に保管してください。

---

## よくある行き止まり

| 症状 | 原因と直し方 |
| --- | --- |
| `Password is not ASCII` で止まる | パスワードに日本語が入っています。英数字だけで作り直してください |
| ビルドのログに「署名: なし」と出る | 4つのうちどれかが未登録です。名前の綴りも確かめてください |
| `keytool: command not found` | `pkg install openjdk-17` がまだです |
| 長い文字列をうまく貼れない | スクリプトを使うとクリップボードに入ります。または `cat ~/upload-base64.txt` |
| すでに鍵を持っているか分からない | 過去に Play へ出したアプリが**いま生きている**なら、その鍵が要ります。消えているなら新しく作って構いません |
