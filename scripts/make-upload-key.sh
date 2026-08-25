#!/usr/bin/env bash
#
# Play にアップロードするための「署名鍵」を作る。
#
# スマホの Termux にこのまま貼り付けて実行できます。
#   bash <(curl -sL https://raw.githubusercontent.com/jannu007/music/main/scripts/make-upload-key.sh)
#
# やること
#   1. Java を用意する
#   2. 鍵ファイル（upload.jks）を作る
#   3. GitHub に登録する4つの値を表示する
#   4. 鍵ファイルを、あとから取り出せる場所へ控える
#
# この鍵は「同じ人が出した更新です」と Play に示すためのものです。
# 失うと、そのアプリは二度と更新できません。必ず控えを取ってください。
set -u

say() { printf '%s\n' "$*"; }
line() { say "------------------------------------------------------------"; }

line
say "  Google Play 用の署名鍵をつくります"
line
say ""

# ------------------------------------------------------------ 1. Java
if ! command -v keytool >/dev/null 2>&1; then
  say "Java が入っていないので、先に入れます（数分かかります）"
  if command -v pkg >/dev/null 2>&1; then
    pkg install -y openjdk-17 || pkg install -y openjdk-21 || {
      say "Java を入れられませんでした。pkg update を実行してから、もう一度お試しください"
      exit 1
    }
  else
    say "この端末には Java がありません。Termux で実行してください"
    exit 1
  fi
fi
say "Java は使えます。"
say ""

# ------------------------------------------------------------ 2. 置き場所
KEYSTORE="${KEYSTORE:-$HOME/upload.jks}"
if [ -e "$KEYSTORE" ]; then
  line
  say "  すでに鍵があります: $KEYSTORE"
  line
  say ""
  say "上書きすると、前の鍵で出したアプリを更新できなくなります。"
  say "作り直したい場合は、先に別名で退避してください。"
  say ""
  say "いまある鍵から、登録用の文字列だけ取り出すこともできます:"
  say "  base64 -w0 \"$KEYSTORE\""
  exit 1
fi

# ------------------------------------------------------------ 3. 名前
say "証明書に入れる名前を決めます（Play の画面には出ません）。"
printf '組織名 [Youkoku]: '
read -r ORG || true
ORG="${ORG:-Youkoku}"
# 記号は証明書の書式を壊すので落とす
ORG="$(printf '%s' "$ORG" | tr -d ',=+<>#;"\\')"
say ""

# ------------------------------------------------------------ 4. パスワード
say "パスワードを決めます。"
say ""
say "  ※ 日本語は使えません（英数字と記号のみ）。"
say "     日本語を入れると Java が受け付けず、途中で止まります。"
say ""
say "  何も入れずに Enter を押すと、強いものを自動で作ります。"
say ""

while :; do
  printf 'パスワード（空 Enter で自動生成）: '
  stty -echo 2>/dev/null || true
  read -r PW || true
  stty echo 2>/dev/null || true
  say ""

  if [ -z "$PW" ]; then
    PW="$(LC_ALL=C tr -dc 'A-HJ-NP-Za-hj-np-z2-9' < /dev/urandom | head -c 24)"
    say "自動で作りました。**この行を必ず控えてください**:"
    say ""
    say "    $PW"
    say ""
    break
  fi

  # ASCII の印字可能文字だけか
  if printf '%s' "$PW" | LC_ALL=C grep -q '[^ -~]'; then
    say "日本語や全角文字が入っています。英数字と記号だけで入れ直してください。"
    continue
  fi
  if [ "${#PW}" -lt 8 ]; then
    say "8文字以上にしてください。"
    continue
  fi

  printf 'もう一度（確認）: '
  stty -echo 2>/dev/null || true
  read -r PW2 || true
  stty echo 2>/dev/null || true
  say ""
  if [ "$PW" != "$PW2" ]; then
    say "一致しません。もう一度お願いします。"
    continue
  fi
  break
done

# ------------------------------------------------------------ 5. 作る
say "鍵を作っています…"
if ! keytool -genkeypair \
  -keystore "$KEYSTORE" \
  -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storetype PKCS12 \
  -storepass "$PW" -keypass "$PW" \
  -dname "CN=$ORG, O=$ORG, C=JP" 2>/tmp/keytool.err; then
  say ""
  say "作れませんでした。出たエラー:"
  sed 's/^/    /' /tmp/keytool.err | head -5
  exit 1
fi

# 本当に読めるか、その場で確かめる
if ! keytool -list -keystore "$KEYSTORE" -storepass "$PW" >/dev/null 2>&1; then
  say "作りましたが、読み出せませんでした。お手数ですが、もう一度お試しください。"
  exit 1
fi
say "できました: $KEYSTORE"
say "  有効期限は約27年（2054年まで）"
say ""

# ------------------------------------------------------------ 6. 控えを取る
BACKUP=""
if [ -d "$HOME/storage/shared" ]; then
  cp "$KEYSTORE" "$HOME/storage/shared/upload.jks" 2>/dev/null &&
    BACKUP="$HOME/storage/shared/upload.jks"
fi

# ------------------------------------------------------------ 7. 登録用の文字列
B64="$(base64 -w0 "$KEYSTORE" 2>/dev/null || base64 "$KEYSTORE" | tr -d '\n')"
COPIED=no
if command -v termux-clipboard-set >/dev/null 2>&1; then
  printf '%s' "$B64" | termux-clipboard-set && COPIED=yes
fi
printf '%s' "$B64" > "$HOME/upload-base64.txt"

line
say "  GitHub に、次の4つを登録してください"
line
say ""
say "リポジトリ → Settings → Secrets and variables → Actions"
say "→ New repository secret を4回"
say ""
say "  1) ANDROID_KEYSTORE_BASE64"
if [ "$COPIED" = yes ]; then
  say "     → クリップボードに入れました。貼り付けるだけです"
else
  say "     → $HOME/upload-base64.txt の中身（${#B64} 文字）"
  say "        開き方: cat ~/upload-base64.txt"
fi
say ""
say "  2) ANDROID_KEYSTORE_PASSWORD"
say "     → いま決めたパスワード"
say ""
say "  3) ANDROID_KEY_ALIAS"
say "     → upload"
say ""
say "  4) ANDROID_KEY_PASSWORD"
say "     → いま決めたパスワード（2 と同じもの）"
say ""
line
say "  失くさないでください"
line
say ""
say "鍵ファイルとパスワードを失うと、そのアプリは二度と更新できません。"
say "Google にも復元してもらえません。"
say ""
if [ -n "$BACKUP" ]; then
  say "  ・鍵ファイルの控え: $BACKUP"
  say "    「ファイル」アプリから見えます。Google ドライブなどへ保存してください"
else
  say "  ・鍵ファイル: $KEYSTORE"
  say "    termux-setup-storage を実行してから、この手順をやり直すと"
  say "    「ファイル」アプリから取り出せる場所にも控えます"
fi
say "  ・パスワード: パスワード管理アプリなどに保存してください"
say ""
say "GitHub の Secrets は登録後に読み出せません。控えにはなりません。"
say ""
