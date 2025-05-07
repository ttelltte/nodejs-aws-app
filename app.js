const express = require('express');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// グローバル変数
let redisClient = null;
let dbPool = null;
const EFS_MOUNT_POINT = '/mnt/efs';

// 設定を取得
const config = {
  elasticache_endpoint: process.env.ELASTICACHE_ENDPOINT,
  aurora_endpoint: process.env.AURORA_ENDPOINT,
  aurora_username: process.env.AURORA_USERNAME,
  aurora_password: process.env.AURORA_PASSWORD,
  efs_mount_point: EFS_MOUNT_POINT
};

// 起動関数
async function bootstrap() {
  try {
    console.log('設定:', config);
    
    // Expressの初期化
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // アクセスログの設定（ここに追加）
    const morgan = require('morgan');
    // カスタムフォーマットでアクセスログを出力
    app.use(morgan(':remote-addr - :method :url :status :res[content-length] - :response-time ms [:date[iso]] :req[x-forwarded-for]'));
    
    // Redisクライアントの初期化
    redisClient = createClient({
      url: `redis://${config.elasticache_endpoint}`
    });
    
    redisClient.on('error', (err) => {
      console.error('Redisエラー:', err);
    });
    
    try {
      await redisClient.connect();
      console.log('Redisに接続しました');
    } catch (redisError) {
      console.error('Redis接続エラー:', redisError);
    }
    
    // セッション設定
    app.use(session({
      store: new RedisStore({ client: redisClient }),
      secret: 'your-secret-key',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false, maxAge: 86400000 } // 24時間
    }));
    
    // MySQLプールの初期化
    try {
      dbPool = mysql.createPool({
        host: config.aurora_endpoint,
        user: config.aurora_username,
        password: config.aurora_password,
        database: 'mysql',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      });
      console.log('データベース接続プールを初期化しました');
    } catch (dbError) {
      console.error('データベース接続エラー:', dbError);
    }
    
    // ステータスページのHTML
    app.get('/', (req, res) => {
      if (!req.session.views) {
        req.session.views = 0;
      }
      req.session.views++;
      
      // EC2インスタンスIDの取得（IMDSv2対応）
      let instanceId = 'Unknown';
      try {
        // IMDSv2トークンの取得
        const token = require('child_process').execSync('curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60"').toString().trim();
        
        // トークンを使ってインスタンスIDを取得
        instanceId = require('child_process').execSync(`curl -s -H "X-aws-ec2-metadata-token: ${token}" http://169.254.169.254/latest/meta-data/instance-id`).toString().trim();
      } catch (err) {
        console.error('インスタンスIDの取得に失敗:', err);
        instanceId = require('os').hostname(); // フォールバックとしてホスト名を使用
      }
      
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>AWS コンポーネントテスト</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            .card { border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin-bottom: 20px; }
            .success { background-color: #d4edda; }
            .error { background-color: #f8d7da; }
            .pending { background-color: #fff3cd; }
            button { background-color: #007bff; color: white; border: none; padding: 8px 15px; border-radius: 4px; cursor: pointer; }
            button:hover { background-color: #0069d9; }
            .instance-info { background-color: #e9ecef; padding: 10px; border-radius: 4px; margin-bottom: 20px; }
            .server-banner { background-color: #343a40; color: white; padding: 15px; border-radius: 4px; margin-bottom: 20px; text-align: center; font-size: 1.2em; }
          </style>
        </head>
        <body>
          <div class="server-banner">
            <h2>インスタンスID: ${instanceId}</h2>
          </div>
          
          <h1>AWS コンポーネントテスト</h1>
          
          <div class="instance-info">
            <h3>セッション情報</h3>
            <p><strong>セッションID:</strong> ${req.session.id}</p>
            <p><strong>アクセス回数:</strong> ${req.session.views}</p>
            <p><strong>最終アクセス:</strong> ${new Date().toLocaleString('ja-JP')}</p>
          </div>
          
          <div class="card" id="redis-card">
            <h3>ElastiCache (Redis)</h3>
            <p><strong>エンドポイント:</strong> ${config.elasticache_endpoint}</p>
            <p><strong>ステータス:</strong> <span id="redis-status">チェック中...</span></p>
            <button onclick="testRedis()">接続テスト</button>
            <div id="redis-result"></div>
          </div>
          
          <div class="card" id="db-card">
            <h3>Aurora (MySQL)</h3>
            <p><strong>エンドポイント:</strong> ${config.aurora_endpoint}</p>
            <p><strong>ステータス:</strong> <span id="db-status">チェック中...</span></p>
            <button onclick="testDatabase()">接続テスト</button>
            <div id="db-result"></div>
          </div>
          
          <div class="card" id="efs-card">
            <h3>EFS ストレージ</h3>
            <p><strong>マウントポイント:</strong> ${config.efs_mount_point}</p>
            <p><strong>ステータス:</strong> <span id="efs-status">チェック中...</span></p>
            <button onclick="testEFS()">アクセステスト</button>
            <div id="efs-result"></div>
          </div>
          
          <script>
            // ページ読み込み時に自動的にすべてのチェックを実行
            window.onload = function() {
              testRedis();
              testDatabase();
              testEFS();
            };
            
            // Redis接続テスト
            function testRedis() {
              document.getElementById('redis-status').textContent = 'テスト中...';
              document.getElementById('redis-card').className = 'card pending';
              
              fetch('/api/test/redis')
                .then(response => response.json())
                .then(data => {
                  document.getElementById('redis-status').textContent = data.status;
                  document.getElementById('redis-card').className = data.success ? 'card success' : 'card error';
                  document.getElementById('redis-result').textContent = data.message;
                })
                .catch(error => {
                  document.getElementById('redis-status').textContent = 'エラー';
                  document.getElementById('redis-card').className = 'card error';
                  document.getElementById('redis-result').textContent = error.message;
                });
            }
            
            // データベース接続テスト
            function testDatabase() {
              document.getElementById('db-status').textContent = 'テスト中...';
              document.getElementById('db-card').className = 'card pending';
              
              fetch('/api/test/database')
                .then(response => response.json())
                .then(data => {
                  document.getElementById('db-status').textContent = data.status;
                  document.getElementById('db-card').className = data.success ? 'card success' : 'card error';
                  document.getElementById('db-result').textContent = data.message;
                })
                .catch(error => {
                  document.getElementById('db-status').textContent = 'エラー';
                  document.getElementById('db-card').className = 'card error';
                  document.getElementById('db-result').textContent = error.message;
                });
            }
            
            // EFSアクセステスト
            function testEFS() {
              document.getElementById('efs-status').textContent = 'テスト中...';
              document.getElementById('efs-card').className = 'card pending';
              
              fetch('/api/test/efs')
                .then(response => response.json())
                .then(data => {
                  document.getElementById('efs-status').textContent = data.status;
                  document.getElementById('efs-card').className = data.success ? 'card success' : 'card error';
                  document.getElementById('efs-result').textContent = data.message;
                })
                .catch(error => {
                  document.getElementById('efs-status').textContent = 'エラー';
                  document.getElementById('efs-card').className = 'card error';
                  document.getElementById('efs-result').textContent = error.message;
                });
            }
          </script>
        </body>
        </html>
      `);
    });
    
    // APIエンドポイント - Redis接続テスト
    app.get('/api/test/redis', async (req, res) => {
      try {
        if (!redisClient.isReady) {
          await redisClient.connect();
        }
        
        const testKey = `test-${Date.now()}`;
        await redisClient.set(testKey, 'test-value');
        const value = await redisClient.get(testKey);
        
        res.json({
          success: true,
          status: '接続成功',
          message: `テストキー "${testKey}" の値: ${value}`
        });
      } catch (error) {
        res.json({
          success: false,
          status: '接続エラー',
          message: error.message
        });
      }
    });
    
    // APIエンドポイント - データベース接続テスト
    app.get('/api/test/database', async (req, res) => {
      try {
        if (!dbPool) {
          throw new Error('データベース接続が初期化されていません');
        }
        
        const connection = await dbPool.getConnection();
        const [rows] = await connection.query('SELECT 1 AS connection_test');
        connection.release();
        
        res.json({
          success: true,
          status: '接続成功',
          message: `クエリ結果: ${JSON.stringify(rows[0])}`
        });
      } catch (error) {
        res.json({
          success: false,
          status: '接続エラー',
          message: error.message
        });
      }
    });
    
    // APIエンドポイント - EFSアクセステスト
    app.get('/api/test/efs', async (req, res) => {
      try {
        if (!fs.existsSync(EFS_MOUNT_POINT)) {
          throw new Error(`マウントポイント ${EFS_MOUNT_POINT} が存在しません`);
        }
        
        const testFilePath = path.join(EFS_MOUNT_POINT, 'test-file.txt');
        const timestamp = new Date().toISOString();
        
        fs.writeFileSync(testFilePath, `EFSテスト: ${timestamp}`);
        const content = fs.readFileSync(testFilePath, 'utf8');
        
        res.json({
          success: true,
          status: 'アクセス成功',
          message: `ファイル内容: ${content}`
        });
      } catch (error) {
        res.json({
          success: false,
          status: 'アクセスエラー',
          message: error.message
        });
      }
    });
    
    // サーバー起動
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`サーバーが起動しました - ポート: ${PORT}`);
    });
    
  } catch (error) {
    console.error('アプリケーションの起動に失敗しました:', error);
    process.exit(1);
  }
}

// プロセス終了時の処理
process.on('SIGTERM', async () => {
  console.log('SIGTERMを受信しました...');
  if (redisClient) await redisClient.quit();
  if (dbPool) await dbPool.end();
  process.exit(0);
});

// アプリケーション起動
bootstrap();