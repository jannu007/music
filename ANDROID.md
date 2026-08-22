# Android 版のつくり方（完全オフライン同梱）

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

## 動作確認のポイント（実機）

1. **機内モードにしてから**アプリを起動する
2. 音が出ること（AudioWorklet がセキュアコンテキストで動いている証拠）
3. WAV / MIDI の書き出しができること
4. URL バーやブラウザの UI がどこにも出ないこと
