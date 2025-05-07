#!/bin/bash
set -e

echo "AWS コンポーネントテストアプリのセットアップを開始します..."

# AWS リージョンを設定
REGION="ap-northeast-1"

# 依存関係のインストール
echo "依存関係をインストールしています..."
npm install express express-session connect-redis redis mysql2 dotenv

# Parameter Storeからエンドポイント情報を取得
echo "AWS Parameter Storeから設定を取得しています..."
ELASTICACHE_ENDPOINT=$(aws ssm get-parameter --name "/terai-test/jrent/elasticache/primary/endpoint" --region $REGION --query "Parameter.Value" --output text)
AURORA_ENDPOINT=$(aws ssm get-parameter --name "/terai-test/jrent/aurora/writer/endpoint" --region $REGION --query "Parameter.Value" --output text)
AURORA_USERNAME=$(aws ssm get-parameter --name "/terai-test/jrent/aurora/username" --region $REGION --query "Parameter.Value" --output text)
AURORA_PASSWORD=$(aws ssm get-parameter --name "/terai-test/jrent/aurora/password" --with-decryption --region $REGION --query "Parameter.Value" --output text)

# .envファイル作成
cat > .env << EOF
ELASTICACHE_ENDPOINT=$ELASTICACHE_ENDPOINT
AURORA_ENDPOINT=$AURORA_ENDPOINT
AURORA_USERNAME=$AURORA_USERNAME
AURORA_PASSWORD=$AURORA_PASSWORD
EOF

# アプリケーションを起動
echo "アプリケーションを起動しています..."
if command -v pm2 &> /dev/null; then
    pm2 start app.js --name "aws-component-test"
    pm2 save
else
    node app.js &
fi

# アクセス方法を表示
INSTANCE_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)
echo ""
echo "===== アプリケーションへのアクセス方法 ====="
echo "以下のURLでコンポーネントテスト画面にアクセスできます:"
echo "http://$INSTANCE_IP:3000/"
echo "============================================"