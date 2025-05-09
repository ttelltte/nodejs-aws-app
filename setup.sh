#!/bin/bash
set -e

echo "AWS コンポーネントテストアプリのセットアップを開始します..."

# 依存関係のインストール
echo "依存関係をインストールしています..."
npm install

# 環境変数の確認（オプション）
echo "環境変数を確認しています..."
if [ -z "$AURORA_WRITER_ENDPOINT" ] || [ -z "$CACHE_PRIMARY_ENDPOINT" ]; then
  echo "警告: 必要な環境変数が設定されていない可能性があります。/etc/environmentを確認してください。"
  echo "必要な環境変数:"
  echo "- AURORA_WRITER_ENDPOINT"
  echo "- AURORA_READER_ENDPOINT"
  echo "- CACHE_PRIMARY_ENDPOINT"
  echo "- CACHE_READER_ENDPOINT"
  echo "- EFS_ID"
fi

# logs ディレクトリ作成
mkdir -p logs

# アプリケーションを起動
echo "アプリケーションを起動しています..."
if command -v pm2 &> /dev/null; then
    pm2 start ecosystem.config.js --env production
    pm2 save
else
    echo "pm2が見つかりません。グローバルにインストールします..."
    npm install -g pm2
    pm2 start ecosystem.config.js --env production
    pm2 save
fi

# アクセス方法を表示
INSTANCE_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 || echo "unknown")
echo ""
echo "===== アプリケーションへのアクセス方法 ====="
echo "以下のURLでコンポーネントテスト画面にアクセスできます:"
echo "http://$INSTANCE_IP:3000/"
echo "============================================"