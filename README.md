# Unicorn Lax

AIによる顔認識で、大量の写真から均等・効率的にアルバム用写真を自動選定するブラウザ完結型ツール。

保育園・幼稚園のアルバム作成など、大量の写真からどの子も均等に映った写真を選ぶ作業を **90%効率化** します。

## 主な機能

- **顔認識・自動分類** — face-api.js によるブラウザ内顔検出＆クラスタリング
- **グループバランスモード** — 複数人が均等に含まれるよう写真を自動選定
- **成長記録モード** — 特定の1人を時系列で追跡し、均等に選定
- **連写検出** — 連続撮影の重複を自動除去
- **フィードバック学習** — 誤分類の修正で精度が向上
- **バックアップ/復元** — JSON形式でデータのエクスポート/インポート
- **完全ブラウザ完結** — 画像がサーバーに送信されることはありません

## 技術スタック

| カテゴリ         | 技術                                                                         |
| :--------------- | :--------------------------------------------------------------------------- |
| フレームワーク   | [Nuxt 4](https://nuxt.com/) (Vue 3)                                          |
| UI               | [Nuxt UI](https://ui.nuxt.com/) + [Tailwind CSS 4](https://tailwindcss.com/) |
| 顔認識           | [face-api.js](https://github.com/justadudewhohacks/face-api.js) (Web Worker) |
| データストレージ | IndexedDB ([idb](https://github.com/jakearchibald/idb))                      |
| ホスティング     | [Cloudflare Pages](https://pages.cloudflare.com/)                            |
| CI/CD            | GitHub Actions                                                               |
| テスト           | [Vitest](https://vitest.dev/)                                                |

## セットアップ

```bash
pnpm install
```

## 開発

```bash
pnpm dev
```

## ビルド

```bash
pnpm build
```

## テスト

```bash
pnpm vitest run
```

## デプロイ

`main` ブランチへの push 時に GitHub Actions 経由で Cloudflare Pages へ自動デプロイされます。

### 必要なシークレット

GitHub リポジトリの Settings > Secrets に以下を設定:

| シークレット名          | 説明                                       |
| :---------------------- | :----------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Cloudflare API トークン (Pages の編集権限) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare アカウント ID                   |

## ライセンス

[MIT](./LICENSE)
