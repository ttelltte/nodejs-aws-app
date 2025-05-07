こちらREADMEを更新しました。Parameter Store のパス変更についての注意事項も含めてシンプルに説明しています：

```markdown
# AWS コンポーネントテストアプリ

このアプリケーションは、Auto Scaling環境におけるAWSコンポーネント（ElastiCache、Aurora、EFS）の検証用シンプルアプリケーションです。

## 概要

- **ElastiCacheセッション検証**: インスタンスが切り替わってもセッション情報を維持
- **Auroraデータベース接続**: データベース接続のテスト
- **EFSアクセステスト**: 共有ファイルシステムへの読み書き検証

## セットアップ方法

1. リポジトリをクローン
   ```
   git clone https://github.com/yourusername/aws-component-test.git
   cd aws-component-test
   ```

2. 必要なモジュールをインストール
   ```
   npm install
   ```

3. セットアップスクリプトを実行
   ```
   npm run setup
   ```

## 重要: Parameter Store設定

setup.shスクリプトは以下のParameter Storeパラメータを参照します：

- `/prod/nodejs-app/elasticache/primary/endpoint`
- `/prod/nodejs-app/aurora/writer/endpoint`
- `/prod/nodejs-app/aurora/username`
- `/prod/nodejs-app/aurora/password`

**環境に応じてこれらのパス接頭辞を変更してください**。例えば：

- 開発環境: `/dev/nodejs-app/...`
- テスト環境: `/test/nodejs-app/...`
- カスタム環境: `/your-env/your-app/...`

setup.shスクリプト内の以下の行を環境に合わせて修正してください：

```bash
# 例: 開発環境の場合
ELASTICACHE_ENDPOINT=$(aws ssm get-parameter --name "/dev/nodejs-app/elasticache/primary/endpoint" --region $REGION --query "Parameter.Value" --output text)
```

## アクセス方法

セットアップ完了後、以下のURLでアプリケーションにアクセスできます：

```
http://[インスタンスIPまたはロードバランサーDNS名]:3000/
```

## 検証項目

1. 複数のインスタンスからアクセスして、セッションカウンター（アクセス回数）が維持されることを確認
2. 各コンポーネント（Redis、Aurora、EFS）の接続テストボタンをクリックして状態を確認
3. インスタンスIDが変わってもセッションIDが維持されることを確認
```

このREADMEは、Parameter Storeのパス設定について明示的に説明し、使用環境に応じて変更する必要があることを強調しています。また、アプリケーションの目的、セットアップ方法、検証項目を簡潔に記載しています。