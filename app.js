const express = require('express');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { getParameters } = require('./aws-params');

// 基本設定
const app = express();
const PORT = process.env.PORT || 3000;
const EFS_PATH = '/mnt/efs/static';
const LOCAL_PATH = path.join(__dirname, 'static');

// 設定情報保存用
let config = {};
let components = {
  redis: { status: 'チェック中...', details: {} },
  database: { status: 'チェック中...', details: {} },
  storage: { status: 'チェック中...', details: {} },
  session: { type: '未設定' }
};

// HTMLテンプレート
const htmlTemplate = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AWSコンポーネントチェッカー</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0-alpha1/dist/css/bootstrap.min.css" rel="stylesheet">
  <style>
    .status-badge {
      width: 100px;
    }
    .component-card {
      transition: all 0.2s;
    }
    .component-card:hover {
      transform: translateY(-3px);
      box-shadow: 0 5px 15px rgba(0,0,0,0.1);
    }
    pre {
      background: #f8f9fa;
      padding: 10px;
      border-radius: 5px;
      max-height: 300px;
      overflow-y: auto;
    }
  </style>
</head>
<body>
  <nav class="navbar navbar-dark bg-primary">
    <div class="container">
      <span class="navbar-brand">AWSコンポーネントチェッカー</span>
      <button id="refresh-btn" class="btn btn-light btn-sm">更新</button>
    </div>
  </nav>

  <div class="container my-4">
    <div class="row mb-4">
      <div class="col-12">
        <div class="alert alert-info">
          <h4 class="alert-heading mb-3">アプリケーション情報</h4>
          <p><strong>ホスト名:</strong> <span id="hostname"></span></p>
          <p><strong>実行環境:</strong> <span id="environment"></span></p>
          <p><strong>接続設定:</strong> <span id="config-source"></span></p>
        </div>
      </div>
    </div>

    <div class="row">
      <!-- Redis -->
      <div class="col-md-6 col-lg-3 mb-4">
        <div class="card component-card h-100" id="redis-card">
          <div class="card-header bg-primary text-white">
            <h5 class="mb-0">Redis Cache</h5>
          </div>
          <div class="card-body">
            <div class="mb-3">
              <span class="badge status-badge" id="redis-status"></span>
            </div>
            <p><strong>エンドポイント:</strong> <span id="redis-endpoint"></span></p>
            <hr>
            <h6>テスト操作</h6>
            <div class="d-grid gap-2">
              <button class="btn btn-sm btn-outline-primary" id="redis-ping-btn">Ping</button>
              <button class="btn btn-sm btn-outline-primary" id="redis-set-btn">Set</button>
              <button class="btn btn-sm btn-outline-primary" id="redis-get-btn">Get</button>
            </div>
            <div id="redis-result" class="mt-3 d-none">
              <h6>結果:</h6>
              <pre id="redis-result-text"></pre>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Database -->
      <div class="col-md-6 col-lg-3 mb-4">
        <div class="card component-card h-100" id="db-card">
          <div class="card-header bg-success text-white">
            <h5 class="mb-0">Aurora Database</h5>
          </div>
          <div class="card-body">
            <div class="mb-3">
              <span class="badge status-badge" id="db-status"></span>
            </div>
            <p><strong>エンドポイント:</strong> <span id="db-endpoint"></span></p>
            <hr>
            <h6>テスト操作</h6>
            <div class="d-grid gap-2">
              <button class="btn btn-sm btn-outline-success" id="db-ping-btn">接続テスト</button>
              <button class="btn btn-sm btn-outline-success" id="db-tables-btn">テーブル一覧</button>
              <button class="btn btn-sm btn-outline-success" id="db-version-btn">バージョン</button>
            </div>
            <div id="db-result" class="mt-3 d-none">
              <h6>結果:</h6>
              <pre id="db-result-text"></pre>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Storage -->
      <div class="col-md-6 col-lg-3 mb-4">
        <div class="card component-card h-100" id="storage-card">
          <div class="card-header bg-warning text-dark">
            <h5 class="mb-0">EFS Storage</h5>
          </div>
          <div class="card-body">
            <div class="mb-3">
              <span class="badge status-badge" id="storage-status"></span>
            </div>
            <p><strong>パス:</strong> <span id="storage-path"></span></p>
            <hr>
            <h6>テスト操作</h6>
            <div class="d-grid gap-2">
              <button class="btn btn-sm btn-outline-warning" id="storage-write-btn">書き込み</button>
              <button class="btn btn-sm btn-outline-warning" id="storage-read-btn">読み込み</button>
              <button class="btn btn-sm btn-outline-warning" id="storage-list-btn">ファイル一覧</button>
            </div>
            <div id="storage-result" class="mt-3 d-none">
              <h6>結果:</h6>
              <pre id="storage-result-text"></pre>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Session -->
      <div class="col-md-6 col-lg-3 mb-4">
        <div class="card component-card h-100" id="session-card">
          <div class="card-header bg-info text-white">
            <h5 class="mb-0">Session Store</h5>
          </div>
          <div class="card-body">
            <div class="mb-3">
              <span class="badge status-badge" id="session-status"></span>
            </div>
            <p><strong>セッションID:</strong> <span id="session-id"></span></p>
            <hr>
            <h6>テスト操作</h6>
            <div class="d-grid gap-2">
              <button class="btn btn-sm btn-outline-info" id="session-set-btn">データ保存</button>
              <button class="btn btn-sm btn-outline-info" id="session-get-btn">データ取得</button>
              <button class="btn btn-sm btn-outline-info" id="session-count-btn">アクセス回数</button>
            </div>
            <div id="session-result" class="mt-3 d-none">
              <h6>結果:</h6>
              <pre id="session-result-text"></pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    // ページ読み込み時の処理
    document.addEventListener('DOMContentLoaded', function() {
      // コンポーネント情報を取得
      fetchComponentStatus();
      
      // 更新ボタン
      document.getElementById('refresh-btn').addEventListener('click', fetchComponentStatus);
      
      // Redisボタン
      document.getElementById('redis-ping-btn').addEventListener('click', function() {
        testComponent('redis', 'ping');
      });
      document.getElementById('redis-set-btn').addEventListener('click', function() {
        testComponent('redis', 'set');
      });
      document.getElementById('redis-get-btn').addEventListener('click', function() {
        testComponent('redis', 'get');
      });
      
      // DBボタン
      document.getElementById('db-ping-btn').addEventListener('click', function() {
        testComponent('database', 'ping');
      });
      document.getElementById('db-tables-btn').addEventListener('click', function() {
        testComponent('database', 'tables');
      });
      document.getElementById('db-version-btn').addEventListener('click', function() {
        testComponent('database', 'version');
      });
      
      // Storageボタン
      document.getElementById('storage-write-btn').addEventListener('click', function() {
        testComponent('storage', 'write');
      });
      document.getElementById('storage-read-btn').addEventListener('click', function() {
        testComponent('storage', 'read');
      });
      document.getElementById('storage-list-btn').addEventListener('click', function() {
        testComponent('storage', 'list');
      });
      
      // Sessionボタン
      document.getElementById('session-set-btn').addEventListener('click', function() {
        testComponent('session', 'set');
      });
      document.getElementById('session-get-btn').addEventListener('click', function() {
        testComponent('session', 'get');
      });
      document.getElementById('session-count-btn').addEventListener('click', function() {
        testComponent('session', 'count');
      });
    });
    
    // コンポーネント状態を取得
    function fetchComponentStatus() {
      fetch('/api/status')
        .then(response => response.json())
        .then(data => {
          updateUI(data);
        })
        .catch(error => {
          console.error('Error fetching status:', error);
        });
    }
    
    // コンポーネントテスト実行
    function testComponent(component, action) {
      const resultElement = document.getElementById(component + '-result');
      const resultTextElement = document.getElementById(component + '-result-text');
      
      resultElement.classList.remove('d-none');
      resultTextElement.textContent = '処理中...';
      
      fetch('/api/' + component + '/' + action)
        .then(response => response.json())
        .then(data => {
          resultTextElement.textContent = JSON.stringify(data, null, 2);
        })
        .catch(error => {
          resultTextElement.textContent = 'エラー: ' + error.message;
        });
    }
    
    // UIを更新
    function updateUI(data) {
      // 基本情報
      document.getElementById('hostname').textContent = data.hostname;
      document.getElementById('environment').textContent = data.environment;
      document.getElementById('config-source').textContent = data.configSource;
      
      // Redis
      updateComponentUI('redis', data.components.redis);
      
      // Database
      updateComponentUI('database', data.components.database, 'db');
      
      // Storage
      updateComponentUI('storage', data.components.storage);
      
      // Session
      updateComponentUI('session', data.components.session);
    }
    
    // コンポーネントUIを更新
    function updateComponentUI(component, data, prefix) {
      const idPrefix = prefix || component;
      
      // ステータス
      const statusElement = document.getElementById(idPrefix + '-status');
      statusElement.textContent = data.status;
      
      if (data.status === '接続済み') {
        statusElement.classList.add('bg-success');
        statusElement.classList.remove('bg-danger', 'bg-warning', 'bg-secondary');
      } else if (data.status === '未接続') {
        statusElement.classList.add('bg-danger');
        statusElement.classList.remove('bg-success', 'bg-warning', 'bg-secondary');
      } else if (data.status === '代替使用中') {
        statusElement.classList.add('bg-warning');
        statusElement.classList.remove('bg-success', 'bg-danger', 'bg-secondary');
      } else {
        statusElement.classList.add('bg-secondary');
        statusElement.classList.remove('bg-success', 'bg-danger', 'bg-warning');
      }
      
      // エンドポイント/パス
      if (component === 'redis') {
        document.getElementById(idPrefix + '-endpoint').textContent = data.endpoint || 'なし';
      } else if (component === 'database') {
        document.getElementById(idPrefix + '-endpoint').textContent = data.endpoint || 'なし';
      } else if (component === 'storage') {
        document.getElementById(idPrefix + '-path').textContent = data.path || 'なし';
      } else if (component === 'session') {
        document.getElementById(idPrefix + '-id').textContent = data.id || 'なし';
      }
    }
  </script>
</body>
</html>
`;

// Redis接続のテスト
async function testRedisConnection() {
  try {
    const redisClient = createClient({
      url: `rediss://${config.elasticache_primary_endpoint}`,
      socket: {
        connectTimeout: 5000,
        tls: true,
        rejectUnauthorized: false
      }
    });
    
    redisClient.on('error', (err) => {
      console.error('Redisエラー:', err.message);
    });
    
    await redisClient.connect();
    const pingResult = await redisClient.ping();
    
    components.redis = {
      status: '接続済み',
      details: {
        endpoint: config.elasticache_primary_endpoint,
        ping: pingResult
      },
      client: redisClient
    };
    
    return redisClient;
  } catch (err) {
    console.error('Redis接続エラー:', err.message);
    components.redis = {
      status: '未接続',
      details: {
        endpoint: config.elasticache_primary_endpoint,
        error: err.message
      }
    };
    return null;
  }
}

// データベース接続のテスト
async function testDatabaseConnection() {
  try {
    const dbPool = mysql.createPool({
      host: config.aurora_writer_endpoint,
      user: config.aurora_username,
      password: config.aurora_password,
      database: 'mysql',
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      connectTimeout: 5000
    });
    
    // 接続テスト
    const connection = await dbPool.getConnection();
    await connection.query('SELECT 1 AS connection_test');
    connection.release();
    
    components.database = {
      status: '接続済み',
      details: {
        endpoint: config.aurora_writer_endpoint,
        user: config.aurora_username
      },
      pool: dbPool
    };
    
    return dbPool;
  } catch (err) {
    console.error('データベース接続エラー:', err.message);
    components.database = {
      status: '未接続',
      details: {
        endpoint: config.aurora_writer_endpoint,
        error: err.message
      }
    };
    return null;
  }
}

// ストレージのテスト
async function testStorageAccess() {
  try {
    // EFSの確認
    if (fs.existsSync(EFS_PATH)) {
      try {
        // 書き込みテスト
        const testFile = path.join(EFS_PATH, '.write-test');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        
        components.storage = {
          status: '接続済み',
          details: {
            type: 'EFS',
            path: EFS_PATH
          }
        };
        
        return EFS_PATH;
      } catch (err) {
        console.error('EFS書き込みエラー:', err.message);
        // ローカルストレージにフォールバック
        if (!fs.existsSync(LOCAL_PATH)) {
          fs.mkdirSync(LOCAL_PATH, { recursive: true });
        }
        
        components.storage = {
          status: '代替使用中',
          details: {
            type: 'Local',
            path: LOCAL_PATH,
            efsError: err.message
          }
        };
        
        return LOCAL_PATH;
      }
    } else {
      // ローカルストレージにフォールバック
      if (!fs.existsSync(LOCAL_PATH)) {
        fs.mkdirSync(LOCAL_PATH, { recursive: true });
      }
      
      components.storage = {
        status: '代替使用中',
        details: {
          type: 'Local',
          path: LOCAL_PATH,
          reason: 'EFSパスが存在しません'
        }
      };
      
      return LOCAL_PATH;
    }
  } catch (err) {
    console.error('ストレージテストエラー:', err.message);
    components.storage = {
      status: '未接続',
      details: {
        error: err.message
      }
    };
    return null;
  }
}

// アプリケーションの初期化
async function initializeApp() {
  try {
    // 設定を取得
    config = await getParameters();
    
    // Redis接続テスト
    const redisClient = await testRedisConnection();
    
    // データベース接続テスト
    const dbPool = await testDatabaseConnection();
    
    // ストレージテスト
    const storagePath = await testStorageAccess();
    
    // セッション設定
    if (redisClient) {
      // Redisセッションストア
      app.use(session({
        store: new RedisStore({ client: redisClient }),
        secret: 'aws-component-checker-secret',
        resave: false,
        saveUninitialized: false,
        cookie: { secure: false, maxAge: 86400000 }
      }));
      
      components.session = {
        status: '接続済み',
        details: {
          type: 'Redis',
          endpoint: config.elasticache_primary_endpoint
        }
      };
    } else {
      // メモリセッションストア
      app.use(session({
        secret: 'aws-component-checker-secret',
        resave: false,
        saveUninitialized: false,
        cookie: { secure: false, maxAge: 86400000 }
      }));
      
      components.session = {
        status: '代替使用中',
        details: {
          type: 'Memory',
          reason: 'Redis未接続'
        }
      };
    }
    
    // 静的ファイルの提供
    if (storagePath) {
      app.use('/static', express.static(storagePath));
    }
    
    // テンプレートの設定
    app.get('/', (req, res) => {
      // アクセスカウンターを更新
      if (!req.session.views) {
        req.session.views = 0;
      }
      req.session.views++;
      
      // セッション情報を更新
      components.session.details.id = req.session.id;
      components.session.details.views = req.session.views;
      
      // HTMLテンプレートを返す
      res.send(htmlTemplate);
    });
    
    // コンポーネント状態API
    app.get('/api/status', (req, res) => {
      res.json({
        hostname: require('os').hostname(),
        environment: process.env.NODE_ENV || 'development',
        configSource: process.env.CONFIG_SOURCE || 'env',
        components: {
          redis: {
            status: components.redis.status,
            endpoint: components.redis.details.endpoint
          },
          database: {
            status: components.database.status,
            endpoint: components.database.details.endpoint
          },
          storage: {
            status: components.storage.status,
            path: components.storage.details ? components.storage.details.path : null,
            type: components.storage.details ? components.storage.details.type : null
          },
          session: {
            status: components.session.status,
            id: req.session.id,
            type: components.session.details.type
          }
        }
      });
    });
    
    // Redis操作API
    app.get('/api/redis/:action', async (req, res) => {
      const action = req.params.action;
      
      if (!components.redis.client) {
        return res.json({
          success: false,
          message: 'Redis未接続',
          action
        });
      }
      
      try {
        let result;
        
        if (action === 'ping') {
          result = await components.redis.client.ping();
          
          return res.json({
            success: true,
            action,
            result
          });
        } else if (action === 'set') {
          const testKey = 'test-key-' + Date.now();
          const testValue = 'テスト値 ' + new Date().toISOString();
          
          result = await components.redis.client.set(testKey, testValue, { EX: 60 });
          
          return res.json({
            success: true,
            action,
            result,
            key: testKey,
            value: testValue,
            ttl: 60
          });
        } else if (action === 'get') {
          // 最後に設定したキーの一覧を取得
          const keys = await components.redis.client.keys('test-key-*');
          
          if (keys.length === 0) {
            return res.json({
              success: false,
              action,
              message: 'キーが見つかりません'
            });
          }
          
          // 最新のキーを取得
          const latestKey = keys.sort().reverse()[0];
          const value = await components.redis.client.get(latestKey);
          
          return res.json({
            success: true,
            action,
            key: latestKey,
            value
          });
        } else {
          return res.json({
            success: false,
            action,
            message: '不明なアクション'
          });
        }
      } catch (err) {
        return res.json({
          success: false,
          action,
          error: err.message
        });
      }
    });
    
    // データベース操作API
    app.get('/api/database/:action', async (req, res) => {
      const action = req.params.action;
      
      if (!components.database.pool) {
        return res.json({
          success: false,
          message: 'データベース未接続',
          action
        });
      }
      
      try {
        let result;
        const connection = await components.database.pool.getConnection();
        
        if (action === 'ping') {
          const [rows] = await connection.query('SELECT 1 AS connection_test');
          connection.release();
          
          return res.json({
            success: true,
            action,
            result: rows[0]
          });
        } else if (action === 'tables') {
          const [rows] = await connection.query('SHOW TABLES');
          connection.release();
          
          const tables = rows.map(row => Object.values(row)[0]);
          
          return res.json({
            success: true,
            action,
            tables
          });
        } else if (action === 'version') {
          const [rows] = await connection.query('SELECT VERSION() AS version');
          connection.release();
          
          return res.json({
            success: true,
            action,
            version: rows[0].version
          });
        } else {
          connection.release();
          return res.json({
            success: false,
            action,
            message: '不明なアクション'
          });
        }
      } catch (err) {
        return res.json({
          success: false,
          action,
          error: err.message
        });
      }
    });
    
    // ストレージ操作API
    app.get('/api/storage/:action', async (req, res) => {
      const action = req.params.action;
      const storageDetails = components.storage.details;
      
      if (!storageDetails || !storageDetails.path) {
        return res.json({
          success: false,
          message: 'ストレージ未設定',
          action
        });
      }
      
      try {
        if (action === 'write') {
          const filename = 'test-file-' + Date.now() + '.txt';
          const content = 'テストファイル ' + new Date().toISOString();
          const filePath = path.join(storageDetails.path, filename);
          
          fs.writeFileSync(filePath, content);
          
          return res.json({
            success: true,
            action,
            filename,
            path: filePath,
            content,
            storage: storageDetails.type
          });
        } else if (action === 'read') {
          // 既存のファイルを検索
          const files = fs.readdirSync(storageDetails.path)
            .filter(file => file.startsWith('test-file-') && file.endsWith('.txt'));
          
          if (files.length === 0) {
            return res.json({
              success: false,
              action,
              message: 'ファイルが見つかりません'
            });
          }
          
          // 最新のファイルを読み込み
          const latestFile = files.sort().reverse()[0];
          const filePath = path.join(storageDetails.path, latestFile);
          const content = fs.readFileSync(filePath, 'utf8');
          
          return res.json({
            success: true,
            action,
            filename: latestFile,
            content,
            storage: storageDetails.type
          });
        } else if (action === 'list') {
          const files = fs.readdirSync(storageDetails.path)
            .filter(file => fs.statSync(path.join(storageDetails.path, file)).isFile())
            .map(file => {
              const stats = fs.statSync(path.join(storageDetails.path, file));
              return {
                name: file,
                size: stats.size,
                modified: stats.mtime
              };
            });
          
          return res.json({
            success: true,
            action,
            files,
            storage: storageDetails.type
          });
        } else {
          return res.json({
            success: false,
            action,
            message: '不明なアクション'
          });
        }
      } catch (err) {
        return res.json({
          success: false,
          action,
          error: err.message
        });
      }
    });
    
    // セッション操作API
    app.get('/api/session/:action', async (req, res) => {
      const action = req.params.action;
      
      try {
        if (action === 'set') {
          req.session.testData = 'テストデータ ' + new Date().toISOString();
          
          return res.json({
            success: true,
            action,
            key: 'testData',
            value: req.session.testData
          });
        } else if (action === 'get') {
          return res.json({
            success: true,
            action,
            key: 'testData',
            value: req.session.testData || '未設定'
          });
        } else if (action === 'count') {
          // アクセスカウンターを更新
          if (!req.session.views) {
            req.session.views = 0;
          }
          req.session.views++;
          
          return res.json({
            success: true,
            action,
            views: req.session.views,
            sessionID: req.session.id,
            type: components.session.details.type
          });
        } else {
          return res.json({
            success: false,
            action,
            message: '不明なアクション'
          });
        }
      } catch (err) {
        return res.json({
          success: false,
          action,
          error: err.message
        });
      }
    });
    
    // サーバー起動
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`サーバーが起動しました - ポート: ${PORT}`);
      console.log(`http://localhost:${PORT} でアクセスできます`);
    });
    
  } catch (err) {
    console.error('アプリケーション初期化エラー:', err);
    process.exit(1);
  }
}

// アプリケーション起動
initializeApp();