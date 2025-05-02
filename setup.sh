#!/bin/bash
set -e  # エラー発生時に停止

echo "============================================="
echo "Node.jsアプリケーションのセットアップと起動を開始します..."
echo "============================================="

# ログディレクトリの作成
mkdir -p logs
LOGFILE="logs/setup-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOGFILE") 2>&1

# AWS リージョンを設定
REGION="ap-northeast-1"

# バックアップディレクトリ作成
echo "重要ファイルのバックアップを作成しています..."
mkdir -p backups
if [ -f "app.js" ]; then cp app.js backups/app.js.bak; fi
if [ -f "aws-params.js" ]; then cp aws-params.js backups/aws-params.js.bak; fi
if [ -f "ecosystem.config.js" ]; then cp ecosystem.config.js backups/ecosystem.config.js.bak; fi
echo "バックアップを作成しました"

# 必要なディレクトリを作成
mkdir -p /mnt/efs/static 2>/dev/null || echo "EFSディレクトリが既に存在します"
mkdir -p static  # ローカル静的ファイル用のフォールバックディレクトリ

# ec2-userとして実行していることを確認
if [ "$(whoami)" != "ec2-user" ]; then
  echo "警告: このスクリプトはec2-userとして実行することを推奨します"
fi

# 権限の設定 - エラーを無視して続行
echo "ディレクトリ権限を設定しています..."
sudo chown -R $(whoami):$(whoami) . || echo "カレントディレクトリの権限設定をスキップしました"
sudo chmod -R 755 static || echo "staticディレクトリの権限設定をスキップしました"
sudo chown -R $(whoami):$(whoami) /mnt/efs/static 2>/dev/null || echo "EFSディレクトリの権限設定をスキップしました"

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

# Parameter Storeから設定を取得 - エラーを無視して続行
echo "AWSパラメータストアから設定を取得しています..."
export ELASTICACHE_PRIMARY_ENDPOINT=$(aws ssm get-parameter --name "/prod/nodejs-app/elasticache/primary/endpoint" --region $REGION --query "Parameter.Value" --output text 2>/dev/null) || \
  echo "ElastiCacheエンドポイントの取得に失敗しました"
export ELASTICACHE_READER_ENDPOINT=$(aws ssm get-parameter --name "/prod/nodejs-app/elasticache/reader/endpoint" --region $REGION --query "Parameter.Value" --output text 2>/dev/null) || \
  echo "ElastiCacheリーダーエンドポイントの取得に失敗しました"
export AURORA_WRITER_ENDPOINT=$(aws ssm get-parameter --name "/prod/nodejs-app/aurora/writer/endpoint" --region $REGION --query "Parameter.Value" --output text 2>/dev/null) || \
  echo "Auroraライターエンドポイントの取得に失敗しました"
export AURORA_READER_ENDPOINT=$(aws ssm get-parameter --name "/prod/nodejs-app/aurora/reader/endpoint" --region $REGION --query "Parameter.Value" --output text 2>/dev/null) || \
  echo "Auroraリーダーエンドポイントの取得に失敗しました"
export AURORA_USERNAME=$(aws ssm get-parameter --name "/prod/nodejs-app/aurora/username" --region $REGION --query "Parameter.Value" --output text 2>/dev/null) || \
  echo "Auroraユーザー名の取得に失敗しました"
export AURORA_PASSWORD=$(aws ssm get-parameter --name "/prod/nodejs-app/aurora/password" --with-decryption --region $REGION --query "Parameter.Value" --output text 2>/dev/null) || \
  echo "Auroraパスワードの取得に失敗しました"
export EFS_FILESYSTEM_ID=$(aws ssm get-parameter --name "/prod/nodejs-app/efs/filesystem/id" --region $REGION --query "Parameter.Value" --output text 2>/dev/null) || \
  echo "EFSファイルシステムIDの取得に失敗しました"

# EC2メタデータから情報を取得
echo "EC2メタデータから情報を取得しています..."
INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id 2>/dev/null) || INSTANCE_ID="unknown"
INSTANCE_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null) || INSTANCE_IP="localhost"
AZ=$(curl -s http://169.254.169.254/latest/meta-data/placement/availability-zone 2>/dev/null) || AZ="unknown"

echo "インスタンス情報:"
echo "インスタンスID: $INSTANCE_ID"
echo "パブリックIP: $INSTANCE_IP"
echo "アベイラビリティゾーン: $AZ"

# 環境変数が取得できない場合のフォールバック値を設定
echo "環境変数のバリデーションと設定..."
if [ -z "$ELASTICACHE_PRIMARY_ENDPOINT" ]; then
  echo "警告: ElastiCacheエンドポイントが設定されていません。デフォルト値を使用します。"
  export ELASTICACHE_PRIMARY_ENDPOINT="master.prod-nodejs-app-elasticache01.gwsp9e.apne1.cache.amazonaws.com"
fi

if [ -z "$ELASTICACHE_READER_ENDPOINT" ]; then
  echo "警告: ElastiCacheリーダーエンドポイントが設定されていません。デフォルト値を使用します。"
  export ELASTICACHE_READER_ENDPOINT="replica.prod-nodejs-app-elasticache01.gwsp9e.apne1.cache.amazonaws.com"
fi

if [ -z "$AURORA_WRITER_ENDPOINT" ]; then
  echo "警告: Auroraライターエンドポイントが設定されていません。デフォルト値を使用します。"
  export AURORA_WRITER_ENDPOINT="nodejs-app-prod-aurora-cluster01.cluster-clasd3yzp60g.ap-northeast-1.rds.amazonaws.com"
fi

if [ -z "$AURORA_READER_ENDPOINT" ]; then
  echo "警告: Auroraリーダーエンドポイントが設定されていません。デフォルト値を使用します。"
  export AURORA_READER_ENDPOINT="nodejs-app-prod-aurora-cluster01.cluster-ro-clasd3yzp60g.ap-northeast-1.rds.amazonaws.com"
fi

if [ -z "$AURORA_USERNAME" ]; then
  echo "警告: Auroraユーザー名が設定されていません。デフォルト値を使用します。"
  export AURORA_USERNAME="awsadminuser"
fi

if [ -z "$AURORA_PASSWORD" ]; then
  echo "警告: Auroraパスワードが設定されていません。デフォルト値を使用します。"
  export AURORA_PASSWORD="dummy_password"  # 実際のパスワードは.envファイルで上書きすべき
fi

if [ -z "$EFS_FILESYSTEM_ID" ]; then
  echo "警告: EFSファイルシステムIDが設定されていません。デフォルト値を使用します。"
  export EFS_FILESYSTEM_ID="fs-09629629eb43719e6"
fi

# 環境変数の表示（パスワードは除く）
echo "取得した設定値:"
echo "ElastiCache Primary Endpoint: $ELASTICACHE_PRIMARY_ENDPOINT"
echo "ElastiCache Reader Endpoint: $ELASTICACHE_READER_ENDPOINT" 
echo "Aurora Writer Endpoint: $AURORA_WRITER_ENDPOINT"
echo "Aurora Reader Endpoint: $AURORA_READER_ENDPOINT"
echo "Aurora Username: $AURORA_USERNAME"
echo "Aurora Password: [REDACTED]"
echo "EFS Filesystem ID: $EFS_FILESYSTEM_ID"

# Node.jsアプリケーションファイルの修正
echo "アプリケーションファイルを修正しています..."

# aws-params.jsの修正 - 環境変数のみを使用するように
cat > aws-params.js << 'EOF'
// aws-params.js - 環境変数優先版
const getParameters = async () => {
  try {
    console.log('環境変数から設定を読み込んでいます...');
    
    // 環境変数の確認と取得
    const config = {
      elasticache_primary_endpoint: process.env.ELASTICACHE_PRIMARY_ENDPOINT,
      elasticache_reader_endpoint: process.env.ELASTICACHE_READER_ENDPOINT,
      aurora_writer_endpoint: process.env.AURORA_WRITER_ENDPOINT,
      aurora_reader_endpoint: process.env.AURORA_READER_ENDPOINT,
      aurora_username: process.env.AURORA_USERNAME,
      aurora_password: process.env.AURORA_PASSWORD,
      efs_filesystem_id: process.env.EFS_FILESYSTEM_ID
    };
    
    // 環境変数のログ表示（パスワードは除く）
    console.log('環境変数確認:');
    console.log(`ELASTICACHE_PRIMARY_ENDPOINT: ${config.elasticache_primary_endpoint}`);
    
    // すべての必要な設定が存在するか確認
    const missingParams = Object.entries(config)
      .filter(([key, value]) => !value)
      .map(([key]) => key);
    
    if (missingParams.length > 0) {
      throw new Error(`以下の環境変数が設定されていません: ${missingParams.join(', ')}`);
    }
    
    console.log('設定の読み込みに成功しました');
    return config;
  } catch (error) {
    console.error('設定の読み込みに失敗しました:', error);
    throw error;
  }
};

module.exports = { getParameters };
EOF
echo "aws-params.jsを修正しました"

# ecosystem.config.jsの修正 - ログ設定を追加
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'nodejs-aws-app',
    script: 'app.js',
    instances: 'max',
    exec_mode: 'cluster',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: 'logs/pm2-error.log',
    out_file: 'logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    // 追加の再起動設定
    restart_delay: 4000, // 再起動前の遅延（ms）
    max_restarts: 10,    // 一定時間内の最大再起動回数
    min_uptime: '30s',   // プロセスが異常とみなされる前の最小稼働時間
    // 優雅なシャットダウン
    kill_timeout: 5000,  // SIGTERMシグナル送信後のkill -9までの時間（ms）
    listen_timeout: 8000 // readyイベント待機時間
  }]
};
EOF
echo "ecosystem.config.jsを修正しました"

# app.jsの修正 - エラーハンドリングの強化とIPバインディングの修正
cat > app.js << 'EOF'
const express = require('express');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { getParameters } = require('./aws-params');

// 設定とグローバル変数
let redisClient = null;
let dbPool = null;
const EFS_MOUNT_POINT = '/mnt/efs';

// 起動時にAWSパラメータを取得し、アプリを初期化
async function bootstrap() {
  try {
    // AWSパラメータの取得
    const config = await getParameters();
    console.log('設定を取得しました');
    
    // Expressアプリの初期化
    const app = express();
    app.use(express.json());
    
    // デバッグエンドポイント - すぐに応答を返す
    app.get('/debug', (req, res) => {
      res.json({
        status: 'debug',
        timestamp: new Date(),
        environment: process.env.NODE_ENV
      });
    });
    
    // Redisクライアントの初期化
    try {
      console.log('Redisに接続しています...');
      redisClient = createClient({
        url: `redis://${config.elasticache_primary_endpoint}`,
        socket: {
          connectTimeout: 10000,
          reconnectStrategy: (retries) => Math.min(retries * 100, 3000)
        }
      });
      
      redisClient.on('error', (err) => {
        console.error('Redisエラー:', err);
      });
      
      await redisClient.connect();
      console.log('Redisに接続しました');
      
      // セッション設定
      app.use(session({
        store: new RedisStore({ client: redisClient }),
        secret: 'your-secret-key', // 本番環境では環境変数やパラメータストアから取得すべき
        resave: false,
        saveUninitialized: false,
        cookie: { secure: false, maxAge: 86400000 } // 24時間
      }));
    } catch (redisError) {
      console.error('Redisへの接続に失敗しました:', redisError);
      // Redisなしでもアプリを続行するためにセッションをメモリに保存
      app.use(session({
        secret: 'your-secret-key',
        resave: false,
        saveUninitialized: false,
        cookie: { secure: false, maxAge: 86400000 }
      }));
    }
    
    // MySQLプールの初期化
    try {
      console.log('データベースに接続しています...');
      dbPool = mysql.createPool({
        host: config.aurora_writer_endpoint,
        user: config.aurora_username,
        password: config.aurora_password,
        database: 'mysql', // 既存のデータベースを使用
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        connectTimeout: 10000
      });
      
      console.log('データベース接続プールを初期化しました');
    } catch (dbError) {
      console.error('データベース接続に失敗しました:', dbError);
      // データベースエラーでもアプリを続行
    }
    
    // EFSのマウント確認
    let efsAvailable = false;
    try {
      if (fs.existsSync(EFS_MOUNT_POINT)) {
        console.log(`EFSがマウントされています: ${EFS_MOUNT_POINT}`);
        // ディレクトリが書き込み可能か確認
        try {
          const testFile = path.join(EFS_MOUNT_POINT, '.write-test');
          fs.writeFileSync(testFile, 'test');
          fs.unlinkSync(testFile);
          app.use('/static', express.static(path.join(EFS_MOUNT_POINT, 'static')));
          efsAvailable = true;
        } catch (fsError) {
          console.error(`EFSディレクトリに書き込みできません: ${EFS_MOUNT_POINT}`, fsError);
        }
      } else {
        console.warn(`EFSのマウントが確認できません: ${EFS_MOUNT_POINT}`);
      }
    } catch (efsError) {
      console.error('EFSチェック中にエラーが発生しました:', efsError);
    }
    
    // 静的ファイル用のフォールバック
    if (!efsAvailable) {
      const localStaticDir = path.join(__dirname, 'static');
      try {
        if (!fs.existsSync(localStaticDir)) {
          fs.mkdirSync(localStaticDir, { recursive: true });
        }
        app.use('/static', express.static(localStaticDir));
        console.log(`ローカル静的ディレクトリを使用します: ${localStaticDir}`);
      } catch (localFsError) {
        console.error('ローカル静的ディレクトリの設定に失敗しました:', localFsError);
      }
    }
    
    // ルートエンドポイント
    app.get('/', (req, res) => {
      res.json({ message: 'Node.jsアプリケーションが動作中です' });
    });
    
    // ヘルスチェック
    app.get('/health', (req, res) => {
      res.status(200).json({ status: 'up', timestamp: new Date() });
    });
    
    // セッションテスト
    app.get('/session-test', (req, res) => {
      if (!req.session.views) {
        req.session.views = 0;
      }
      req.session.views++;
      
      res.json({
        message: 'セッションテスト',
        views: req.session.views,
        sessionID: req.session.id
      });
    });
    
    // システム状態確認
    app.get('/system-info', async (req, res) => {
      try {
        // データベース接続テスト
        let dbStatus = { status: 'unknown' };
        if (dbPool) {
          try {
            const connection = await dbPool.getConnection();
            const [rows] = await connection.query('SELECT 1 AS connection_test');
            connection.release();
            dbStatus = {
              status: 'connected',
              test: rows[0].connection_test === 1
            };
          } catch (dbError) {
            dbStatus = {
              status: 'error',
              message: dbError.message
            };
          }
        } else {
          dbStatus = {
            status: 'not_configured'
          };
        }
        
        // Redis接続テスト
        let redisStatus = { status: 'unknown' };
        if (redisClient && redisClient.isOpen) {
          try {
            const pong = await redisClient.ping();
            redisStatus = {
              status: 'connected',
              test: pong === 'PONG'
            };
          } catch (redisError) {
            redisStatus = {
              status: 'error',
              message: redisError.message
            };
          }
        } else {
          redisStatus = {
            status: 'not_connected'
          };
        }
        
        // EFSアクセステスト
        let efsStatus = { status: 'unknown' };
        try {
          if (fs.existsSync(EFS_MOUNT_POINT)) {
            try {
              const testFilePath = path.join(EFS_MOUNT_POINT, 'test-write.txt');
              const timestamp = new Date().toISOString();
              fs.writeFileSync(testFilePath, `EFS write test: ${timestamp}`);
              const content = fs.readFileSync(testFilePath, 'utf8');
              
              efsStatus = {
                status: 'available',
                mountPoint: EFS_MOUNT_POINT,
                writeTest: content.includes(timestamp)
              };
            } catch (writeError) {
              efsStatus = {
                status: 'mounted_but_not_writable',
                mountPoint: EFS_MOUNT_POINT,
                error: writeError.message
              };
            }
          } else {
            efsStatus = {
              status: 'not_mounted',
              mountPoint: EFS_MOUNT_POINT
            };
          }
        } catch (efsError) {
          efsStatus = {
            status: 'error',
            message: efsError.message
          };
        }
        
        // 結果を返す
        res.json({
          timestamp: new Date(),
          hostname: require('os').hostname(),
          database: dbStatus,
          cache: redisStatus,
          storage: efsStatus,
          session: req.session ? { id: req.session.id } : null,
          config: {
            // 一部の設定情報（機密情報は除く）
            nodeEnv: process.env.NODE_ENV,
            port: process.env.PORT || 3000
          }
        });
      } catch (error) {
        console.error('システム情報の取得中にエラーが発生しました:', error);
        res.status(500).json({ error: 'システム情報の取得中にエラーが発生しました' });
      }
    });
    
    // エラーハンドリング
    app.use((err, req, res, next) => {
      console.error('アプリケーションエラー:', err);
      res.status(500).json({ error: 'サーバーエラーが発生しました' });
    });
    
    // サーバー起動
    const PORT = process.env.PORT || 3000;
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`サーバーが起動しました - ポート: ${PORT}`);
    });
    
    server.on('error', (error) => {
      console.error('サーバー起動エラー:', error);
      process.exit(1);
    });
    
  } catch (error) {
    console.error('アプリケーションの起動に失敗しました:', error);
    process.exit(1);
  }
}

// プロセス終了時の処理
process.on('SIGTERM', async () => {
  console.log('SIGTERMを受信しました...');
  if (redisClient && redisClient.isOpen) await redisClient.quit();
  if (dbPool) await dbPool.end();
  process.exit(0);
});

// プロセスエラー時の処理
process.on('uncaughtException', (error) => {
  console.error('未処理の例外が発生しました:', error);
  // エラーログ保存のための処理をここに追加
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未処理のPromise拒否が発生しました:', reason);
  // エラーログ保存のための処理をここに追加
});

// アプリケーション起動
bootstrap();
EOF
echo "app.jsを修正しました"

# 環境変数の永続化 - PM2用の.envファイル作成
cat > .env << EOF
ELASTICACHE_PRIMARY_ENDPOINT=$ELASTICACHE_PRIMARY_ENDPOINT
ELASTICACHE_READER_ENDPOINT=$ELASTICACHE_READER_ENDPOINT
AURORA_WRITER_ENDPOINT=$AURORA_WRITER_ENDPOINT
AURORA_READER_ENDPOINT=$AURORA_READER_ENDPOINT
AURORA_USERNAME=$AURORA_USERNAME
AURORA_PASSWORD=$AURORA_PASSWORD
EFS_FILESYSTEM_ID=$EFS_FILESYSTEM_ID
PORT=3000
EOF

# .envファイルの権限設定
chmod 600 .env
echo ".envファイルを作成し、権限を設定しました"

# 実行中のアプリケーションがあれば停止
echo "既存のアプリケーションを停止しています..."
if pm2 list | grep -q "nodejs-aws-app"; then
    pm2 stop nodejs-aws-app || echo "アプリケーションの停止に失敗しました"
    pm2 delete nodejs-aws-app || echo "アプリケーションの削除に失敗しました"
fi

# ポート3000の使用状況確認
echo "ポート3000の使用状況を確認しています..."
if command -v lsof &> /dev/null; then
  lsof -i:3000 || echo "ポート3000は使用されていません"
else
  netstat -tulpn 2>/dev/null | grep ":3000" || echo "ポート3000は使用されていません"
fi

# ファイアウォール設定の確認
echo "ファイアウォール設定を確認しています..."
if command -v iptables &> /dev/null; then
  sudo iptables -L INPUT | grep 3000 || echo "ポート3000のファイアウォールルールは見つかりません"
fi

# デバッグ: システム情報収集
echo "システム情報を収集しています..."
echo "メモリ使用状況:"
free -m || echo "メモリ情報の取得に失敗しました"

echo "ディスク使用状況:"
df -h || echo "ディスク情報の取得に失敗しました"

echo "EFSマウント状態:"
df -h | grep efs || echo "EFSマウントは見つかりません"

# PM2でアプリケーションを起動（クラスターモード）
echo "アプリケーションを起動しています..."
pm2 start ecosystem.config.js --env production

# 起動後の検証
echo "アプリケーションの起動を検証しています..."
sleep 5  # 起動を待機

# PM2ステータスの確認
echo "現在のPM2ステータス:"
pm2 status

# ポート3000の使用状況を再確認
echo "ポート3000のリッスン状態を確認しています..."
if command -v lsof &> /dev/null; then
  lsof -i:3000 || echo "警告: ポート3000がリッスンしていません"
else
  netstat -tulpn 2>/dev/null | grep ":3000" || echo "警告: ポート3000がリッスンしていません"
fi

# ローカル接続テスト
echo "ローカル接続をテストしています..."
curl -s http://localhost:3000/health || {
  echo "警告: ローカル接続に失敗しました"
  
  # 失敗した場合のデバッグ情報
  echo "PM2ログを確認します..."
  pm2 logs --lines 20 --nostream
}

# PM2プロセスを保存（再起動時に復元するため）
echo "PM2プロセスリストを保存しています..."
pm2 save

# PM2の起動スクリプトを生成して設定（systemd向け）
echo "PM2起動スクリプトを設定しています..."
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $(whoami) --hp $HOME
sudo systemctl enable pm2-$(whoami)

# サーバーへのアクセス方法を表示
echo ""
echo "===== アプリケーションへのアクセス方法 ====="
echo "以下のURLでアプリケーションにアクセスできます:"
echo "- http://$INSTANCE_IP:3000/ (ルートエンドポイント - アプリの動作確認)"
echo "- http://$INSTANCE_IP:3000/debug (デバッグエンドポイント - 即時レスポンス)"
echo "- http://$INSTANCE_IP:3000/health (ヘルスチェックエンドポイント)"
echo "- http://$INSTANCE_IP:3000/system-info (システム情報エンドポイント)"
echo "- http://$INSTANCE_IP:3000/session-test (セッションテストエンドポイント)"
echo ""
echo "※EC2インスタンスのセキュリティグループでポート3000へのアクセスが許可されていることを確認してください。"
echo "※ALBが設定されている場合は、ALBのDNS名でもアクセス可能です。"
echo "====================================="

echo "問題が発生した場合は、以下のコマンドでログを確認してください:"
echo "pm2 logs"
echo "cat logs/pm2-error.log"
echo "cat logs/pm2-out.log"
echo "または、セットアップログ: $LOGFILE"

echo "セットアップと起動が完了しました！"