Languages: [English](../../README.md) | 日本語 | [简体中文](./README.zh-Hans.md)

# myTE Tools (Tampermonkey)

`myTE Tools` は `https://myte.accenture.com/*` 向けの Tampermonkey ユーザースクリプトです。

以下の2機能を1つのツールバーで提供します。

- Working Hours 自動入力（残業連携・休暇スキップ対応）
- EMLメール生成（Summary/Time/Expenses/Adjustments のスクリーンショット埋め込み）

## 主な機能

- myTEヘッダーにツールバーを追加
  - `⏰` Working Hours ダイアログを開く
  - `📧` Email Template ダイアログを開く
- Working Hours の Work/Break/Work 行を自動入力
- Daily Overtime 行から残業時間を自動連携（任意）
- 設定した休暇コードをスキップ（任意）
- 次の4タブの画像を埋め込んだ `.eml` を生成
  - Summary
  - Time
  - Expenses
  - Adjustments
- メールテンプレートを Tampermonkey ストレージに保存

## インストール

1. ブラウザに `Tampermonkey` をインストールします。
2. 拡張機能設定で次を有効化します。
   - Developer mode
   - Allow user scripts

![Extensions settings](../../public/images/Extensions.png)
![Allow user scripts](../../public/images/UserScript.png)

3. 以下のURLを開きます。

```text
https://raw.githubusercontent.com/jerrywdlee/myTE-Tools/main/Tampermonkey/myte-tools.user.js
```

4. Tampermonkeyのインストール画面で `Install` をクリックします。
5. Tampermonkey上で `myTE Tools` スクリプトが有効（ON）になっていることを確認します。

![Tampermonkey で myTE Tools を有効化](../../public/images/image.png)

6. myTEをリロードして Working Hours 画面を開きます。

## 使い方

### Working Hours (`⏰`)

1. ツールバーの `⏰` をクリック

![Header toolbar buttons](../../public/images/image-1.png)

2. 必要に応じて (Work / Break / Work) の行を調整

![Sample generated email content](../../public/images/image-2.png)

3. 必要に応じて以下のチェックボックスをON
  - `Auto-sync Overtime`: 残業時間を自動的に反映する
  - `Skip Vacations`: 有給など休みが入った日に対して、自動記入しない
4. `START FILLING` をクリック
5. 完了通知を待つ

### Email EML (`📧`)

1. ツールバーの `📧` をクリック

![Header toolbar buttons](../../public/images/image-1.png)

2. YAML frontmatter + Markdown テンプレートを編集

![Sample generated email content](../../public/images/image-3.png)

3. `Download Email` をクリック
4. 4タブをキャプチャした `.eml` がダウンロードされます


### Emailテンプレートの書き方

メールテンプレートは、JekyllのYAML front matterに準拠した1つのドキュメントです。

- YAML front matter（`---` と `---` の間）にメタデータを記述
- Markdown本文にメール本文を記述

参考:

- [Front Matter | Jekyll • Simple, blog-aware, static sites](https://jekyllrb.com/docs/front-matter/)

例:

```yaml
---
from: 'from@example.com'
to: 'to@example.com'
cc:
  - 'cc@example.com'
subject: '[myTE] Period {{period}} Approval Request'
---
```

```markdown
Dear Team,

## Summary
{{Summary}}
## Time
{{Time}}
## Expenses
{{Expenses}}
## Adjustments
{{Adjustments}}

regards,
```

利用できるメタデータキー:

- `from`: 送信者アドレス
- `to`: 宛先アドレス
- `cc`: CCアドレス（配列またはカンマ区切り文字列）
- `subject`: 件名テンプレート
- `displayName`: フォールバック件名とファイル名に利用

件名の変数:

- `{{period}}` は `2026/04/15` のような現在の期間に置換されます

本文のプレースホルダー:

- `{{Summary}}`, `{{Time}}`, `{{Expenses}}`, `{{Adjustments}}` は、HTMLメール本文でキャプチャ画像に置換されます

## 更新について

上記の `raw.githubusercontent.com` URL から導入している場合、Tampermonkey は同URLを使って更新確認できます。

## 謝辞

このプロジェクトは以下のプロジェクトからインスピレーションを得ています。

- [ballban/MyTE_Auto_Filler](https://github.com/ballban/MyTE_Auto_Filler)
- [souka-souka/myTE-Eml-Auto-Generator](https://github.com/souka-souka/myTE-Eml-Auto-Generator)
- [ava-innersource/myte-automate: This automate myTE Working Hours input](https://github.com/ava-innersource/myte-automate)
