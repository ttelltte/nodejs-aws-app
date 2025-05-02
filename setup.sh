#!/bin/bash
set -e  # エラー発生時に停止

echo "Node.jsアプリケーションのセットアップと起動を開始します..."

# ログディレクトリの作成
mkdir -p logs
LOGFILE="logs/setup-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOGFILE") 2>&1

# AWS リージョンを設定
REGION="ap-northeast-1"

# 必要なディレクトリを作成
mkdir -p /mnt/efs/static 2>/dev/null || echo "EFSディレクトリが既に存在します"

# ec2-userとして実行していることを確認
if [ "$(whoami)" != "ec2-user" ]; then
  echo "警告: このスクリプトはec2-userとして実行することを推奨します"
fi

# 権限の設定
sudo chown -R ec2-user:ec2-user .
sudo chown -R ec2-user:ec2-user /mnt/efs/static 2>/dev/null || echo "EFSディレクトリの権限設定に失敗しました"

# 依存関係のインストール
echo "依存関係をインストールしています..."
npm install

# PM2のインストール（グローバル）
echo "PM2をインストールしています..."
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
    echo "PM2をインストールしました"
else
    echo "PM2は既にインストールされています"
fi

# Parameter Storeからエンドポイント情報を取得
echo "AWSパラメータストアから設定を取得しています..."
export ELASTICACHE_PRIMARY_ENDPOINT=$(aws ssm get-parameter --name "/prod/nodejs-app/elasticache/primary/endpoint" --region $REGION --query "Parameter.Value" --output text)
export ELASTICACHE_READER_ENDPOINT=$(aws ssm get-parameter --name "/prod/nodejs-app/elasticache/reader/endpoint" --region $REGION --query "Parameter.Value" --output text)
export AURORA_WRITER_ENDPOINT=$(aws ssm get-parameter --name "/prod/nodejs-app/aurora/writer/endpoint" --region $REGION --query "Parameter.Value" --output text)
export AURORA_READER_ENDPOINT=$(aws ssm get-parameter --name "/prod/nodejs-app/aurora/reader/endpoint" --region $REGION --query "Parameter.Value" --output text)
export AURORA_USERNAME=$(aws ssm get-parameter --name "/prod/nodejs-app/aurora/username" --region $REGION --query "Parameter.Value" --output text)
export AURORA_PASSWORD=$(aws ssm get-parameter --name "/prod/nodejs-app/aurora/password" --with-decryption --region $REGION --query "Parameter.Value" --output text)
export EFS_FILESYSTEM_ID=$(aws ssm get-parameter --name "/prod/nodejs-app/efs/filesystem/id" --region $REGION --query "Parameter.Value" --output text)

# 環境変数が設定されたことを確認
echo "取得した設定値:"
echo "ElastiCache Primary Endpoint: $ELASTICACHE_PRIMARY_ENDPOINT"
echo "ElastiCache Reader Endpoint: $ELASTICACHE_READER_ENDPOINT" 
echo "Aurora Writer Endpoint: $AURORA_WRITER_ENDPOINT"
echo "Aurora Reader Endpoint: $AURORA_READER_ENDPOINT"
echo "Aurora Username: $AURORA_USERNAME"
echo "Aurora Password: [REDACTED]"
echo "EFS Filesystem ID: $EFS_FILESYSTEM_ID"

# 環境変数の永続化 - PM2用の.envファイル作成
cat > .env << EOF
ELASTICACHE_PRIMARY_ENDPOINT=$ELASTICACHE_PRIMARY_ENDPOINT
ELASTICACHE_READER_ENDPOINT=$ELASTICACHE_READER_ENDPOINT
AURORA_WRITER_ENDPOINT=$AURORA_WRITER_ENDPOINT
AURORA_READER_ENDPOINT=$AURORA_READER_ENDPOINT
AURORA_USERNAME=$AURORA_USERNAME
AURORA_PASSWORD=$AURORA_PASSWORD
EFS_FILESYSTEM_ID=$EFS_FILESYSTEM_ID
EOF

# 実行中のアプリケーションがあれば停止
if pm2 list | grep -q "nodejs-aws-app"; then
    echo "既存のアプリケーションを停止しています..."
    pm2 stop nodejs-aws-app
    pm2 delete nodejs-aws-app
fi

# PM2でアプリケーションを起動（クラスターモード）
echo "アプリケーションを起動しています..."
pm2 start ecosystem.config.js --env production

# PM2プロセスを保存（再起動時に復元するため）
echo "PM2プロセスリストを保存しています..."
pm2 save

# PM2の起動スクリプトを生成して設定（systemd向け）
echo "PM2起動スクリプトを設定しています..."
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ec2-user --hp /home/ec2-user
sudo systemctl enable pm2-ec2-user

# PM2ステータスの確認
echo "現在のPM2ステータス:"
pm2 status

# サーバーへのアクセス方法を表示
echo ""
echo "===== アプリケーションへのアクセス方法 ====="
echo "以下のURLでアプリケーションにアクセスできます:"
INSTANCE_IP=$(curl ifconfig.me)
echo "- http://$INSTANCE_IP:3000/ (ルートエンドポイント - アプリの動作確認)"
echo "- http://$INSTANCE_IP:3000/health (ヘルスチェックエンドポイント)"
echo "- http://$INSTANCE_IP:3000/system-info (システム情報エンドポイント)"
echo "- http://$INSTANCE_IP:3000/session-test (セッションテストエンドポイント)"
echo ""
echo "※EC2インスタンスのセキュリティグループでポート3000へのアクセスが許可されていることを確認してください。"
echo "※ALBが設定されている場合は、ALBのDNS名でもアクセス可能です。"
echo "====================================="

echo "セットアップと起動が完了しました！"