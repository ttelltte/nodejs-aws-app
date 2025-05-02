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
    
    // Redisクライアントの初期化
    redisClient = createClient({
      url: `redis://${config.elasticache_primary_endpoint}`
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
    
    // MySQLプールの初期化
    dbPool = mysql.createPool({
      host: config.aurora_writer_endpoint,
      user: config.aurora_username,
      password: config.aurora_password,
      database: 'mysql', // 既存のデータベースを使用
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
    
    console.log('データベース接続プールを初期化しました');
    
    // EFSのマウント確認
    if (fs.existsSync(EFS_MOUNT_POINT)) {
      console.log(`EFSがマウントされています: ${EFS_MOUNT_POINT}`);
      app.use('/static', express.static(path.join(EFS_MOUNT_POINT, 'static')));
    } else {
      console.warn(`EFSのマウントが確認できません: ${EFS_MOUNT_POINT}`);
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
        
        // Redis接続テスト
        let redisStatus = { status: 'unknown' };
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
        
        // EFSアクセステスト
        let efsStatus = { status: 'unknown' };
        try {
          if (fs.existsSync(EFS_MOUNT_POINT)) {
            const testFilePath = path.join(EFS_MOUNT_POINT, 'test-write.txt');
            const timestamp = new Date().toISOString();
            fs.writeFileSync(testFilePath, `EFS write test: ${timestamp}`);
            const content = fs.readFileSync(testFilePath, 'utf8');
            
            efsStatus = {
              status: 'available',
              mountPoint: EFS_MOUNT_POINT,
              writeTest: content.includes(timestamp)
            };
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
            aurora_reader_endpoint: config.aurora_reader_endpoint,
            aurora_writer_endpoint: config.aurora_writer_endpoint,
            elasticache_primary_endpoint: config.elasticache_primary_endpoint,
            efs_filesystem_id: config.efs_filesystem_id
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