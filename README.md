# Node.js AWSコンポーネントチェッカー - 完全ガイド

## 概要

このプロジェクトは、主要なAWSコンポーネント（ElastiCache(Redis)、Aurora DB、EFSストレージ）の接続状態を視覚的に確認し、基本的な操作をテストするためのWebアプリケーションです。このドキュメントでは、ゼロからこのアプリケーションを理解し、開発を継続するために必要な情報を提供します。

## プロジェクトの目的

このアプリケーションは以下の目的で開発されました：

1. AWS環境上のNode.jsアプリケーションの健全性を確認する
2. 各AWSコンポーネントへの接続状態を視覚的に把握する
3. 簡単な操作テストを実行して各コンポーネントの機能を検証する
4. 障害発生時に自動的に代替手段にフォールバックする堅牢なアプリケーションを実現する

## 前提知識

このプロジェクトを理解し開発を継続するには、以下の基本的な知識が必要です：

### プログラミング言語とフレームワーク
- **JavaScript/Node.js**: サーバーサイドコードの開発言語
- **Express**: Webアプリケーションフレームワーク
- **HTML/CSS/クライアントサイドJavaScript**: フロントエンドの基本

### AWSサービス
- **ElastiCache (Redis)**: インメモリキャッシュとセッションストア
- **Aurora/RDS**: リレーショナルデータベースサービス
- **EFS**: Elastic File System、NFSベースのファイルストレージ
- **EC2**: アプリケーションを実行する仮想サーバー

## 環境設定

### 必要なソフトウェア
- Node.js v14以上
- npm 6以上
- AWS CLI（設定用、オプション）

### AWSサービスの設定
1. **ElastiCache (Redis)**:
   - 転送中の暗号化を有効にしたRedisクラスターの作成
   - セキュリティグループでEC2からのアクセスを許可（ポート6379）

2. **Aurora DB**:
   - MySQL互換のAuroraクラスターの作成
   - マスター/リーダーエンドポイントの確認
   - セキュリティグループでEC2からのアクセスを許可（ポート3306）

3. **EFS**:
   - EFSボリュームの作成
   - EC2へのマウント設定
   - マウントポイント（通常 `/mnt/efs`）への読み書き権限設定

4. **EC2**:
   - 適切なIAMロールの設定（EFS、ElastiCache、Auroraへのアクセス権）
   - セキュリティグループの設定（ポート3000でのHTTPアクセス許可）

## プロジェクトのインストール

### リポジトリのセットアップ
```bash
# プロジェクトディレクトリを作成
mkdir nodejs-aws-app
cd nodejs-aws-app

# Gitリポジトリの初期化（オプション）
git init

# package.jsonの作成
npm init -y
```

### 依存パッケージのインストール
```bash
npm install express express-session connect-redis redis mysql2 dotenv
```

### ファイル構造の作成
```bash
touch app.js aws-params.js .env
mkdir static
```

## 設定ファイル

### .envファイル
以下の環境変数を`.env`ファイルに設定します：

```
# ElastiCache設定
ELASTICACHE_PRIMARY_ENDPOINT=master.prod-nodejs-app-elasticache01.gwsp9e.apne1.cache.amazonaws.com
ELASTICACHE_READER_ENDPOINT=replica.prod-nodejs-app-elasticache01.gwsp9e.apne1.cache.amazonaws.com

# Aurora設定
AURORA_WRITER_ENDPOINT=nodejs-app-prod-aurora-cluster01.cluster-clasd3yzp60g.ap-northeast-1.rds.amazonaws.com
AURORA_READER_ENDPOINT=nodejs-app-prod-aurora-cluster01.cluster-ro-clasd3yzp60g.ap-northeast-1.rds.amazonaws.com
AURORA_USERNAME=awsadminuser
AURORA_PASSWORD=your_password_here

# EFS設定
EFS_FILESYSTEM_ID=fs-09629629eb43719e6

# アプリケーション設定
PORT=3000
NODE_ENV=production
```

### aws-params.js
環境変数から設定パラメータを取得するモジュールです：

```javascript
// aws-params.js - シンプル版（環境変数またはデフォルト値を使用）
require('dotenv').config();

const getParameters = async () => {
  try {
    console.log('環境変数から設定を読み込んでいます...');
    
    // 環境変数またはデフォルト値を使用
    const config = {
      elasticache_primary_endpoint: process.env.ELASTICACHE_PRIMARY_ENDPOINT || 'master.prod-nodejs-app-elasticache01.gwsp9e.apne1.cache.amazonaws.com',
      elasticache_reader_endpoint: process.env.ELASTICACHE_READER_ENDPOINT || 'replica.prod-nodejs-app-elasticache01.gwsp9e.apne1.cache.amazonaws.com',
      aurora_writer_endpoint: process.env.AURORA_WRITER_ENDPOINT || 'nodejs-app-prod-aurora-cluster01.cluster-clasd3yzp60g.ap-northeast-1.rds.amazonaws.com',
      aurora_reader_endpoint: process.env.AURORA_READER_ENDPOINT || 'nodejs-app-prod-aurora-cluster01.cluster-ro-clasd3yzp60g.ap-northeast-1.rds.amazonaws.com',
      aurora_username: process.env.AURORA_USERNAME || 'awsadminuser',
      aurora_password: process.env.AURORA_PASSWORD || 'password',
      efs_filesystem_id: process.env.EFS_FILESYSTEM_ID || 'fs-09629629eb43719e6'
    };
    
    console.log('設定の読み込みに成功しました');
    return config;
  } catch (error) {
    console.error('設定の読み込みに失敗しました:', error);
    throw error;
  }
};

module.exports = { getParameters };
```

## アプリケーションコード（app.js）

メインアプリケーションファイルは長いため、主要部分に分けて説明します：

### 1. 基本設定
```javascript
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
```

### 2. HTML テンプレート
フロントエンドの表示に使用するHTMLテンプレートです。JavaScriptのテンプレートリテラル内にHTMLを記述しています。重要なポイント：

- クライアントサイドのJavaScriptでは、テンプレートリテラル（`${}`）を使用してDOM要素にアクセスしています。
- サーバーサイドのNode.jsコード内では、テンプレートリテラル構文は使用せず、文字列連結（+）を使用します。

```javascript
const htmlTemplate = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AWSコンポーネントチェッカー</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0-alpha1/dist/css/bootstrap.min.css" rel="stylesheet">
  <style>
    /* スタイル省略... */
  </style>
</head>
<body>
  <!-- HTML内容省略... -->
  
  <script>
    // クライアントサイドJavaScript省略...
  </script>
</body>
</html>
`;
```

### 3. Redis接続テスト関数
```javascript
async function testRedisConnection() {
  try {
    // 転送中の暗号化に対応したRedisクライアント設定
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
    
    // 接続成功時の情報を保存
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
    // 接続失敗時の処理
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
```

### 4. データベース接続テスト関数
```javascript
async function testDatabaseConnection() {
  try {
    // Aurora DB接続プール設定
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
    
    // 接続成功時の情報を保存
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
    // 接続失敗時の処理
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
```

### 5. ストレージアクセステスト関数
```javascript
async function testStorageAccess() {
  try {
    // EFSの確認
    if (fs.existsSync(EFS_PATH)) {
      try {
        // 書き込みテスト
        const testFile = path.join(EFS_PATH, '.write-test');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        
        // EFS利用可能
        components.storage = {
          status: '接続済み',
          details: {
            type: 'EFS',
            path: EFS_PATH
          }
        };
        
        return EFS_PATH;
      } catch (err) {
        // EFS書き込み権限なし - ローカルにフォールバック
        console.error('EFS書き込みエラー:', err.message);
        
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
      // EFSパスが存在しない - ローカルにフォールバック
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
    // その他のエラー
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
```

### 6. アプリケーション初期化関数
```javascript
async function initializeApp() {
  try {
    // 設定を取得
    config = await getParameters();
    
    // 各コンポーネントテスト実行
    const redisClient = await testRedisConnection();
    const dbPool = await testDatabaseConnection();
    const storagePath = await testStorageAccess();
    
    // セッション設定（Redisが使えればRedisストア、なければメモリストア）
    if (redisClient) {
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
    
    // 以下、各種ルートハンドラとAPIエンドポイント設定...
    
    // アプリケーション起動
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`サーバーが起動しました - ポート: ${PORT}`);
      console.log(`http://localhost:${PORT} でアクセスできます`);
    });
  } catch (err) {
    console.error('アプリケーション初期化エラー:', err);
    process.exit(1);
  }
}
```

## コードの解説

### 主要な設計パターン

1. **フォールバックパターン**:
   - Redisに接続できない場合、メモリ内セッションストアにフォールバック
   - EFSが利用できない場合、ローカルファイルシステムにフォールバック
   - データベース接続に失敗しても、他の機能は継続動作

2. **単一ページアプリケーション**:
   - すべての機能を1つのHTML/JSで実装
   - クライアント-サーバー間のやり取りはJSON APIを使用

3. **コンポーネント分離**:
   - 各AWSコンポーネント（Redis、DB、EFS）は独立したモジュールとして実装
   - それぞれの状態を個別に管理

### 重要なコード概念

#### 1. Redis接続（ElastiCache）
- **転送中の暗号化**: `rediss://`プロトコルの使用が必要
- **TLS設定**: `tls: true, rejectUnauthorized: false`
- **タイムアウト処理**: `connectTimeout: 5000`

#### 2. データベース接続（Aurora）
- **コネクションプール**: `mysql2`の`createPool`を使用
- **接続制限**: `connectionLimit: 5, queueLimit: 0`
- **適切なエラーハンドリング**: 各クエリでtry/catchを使用

#### 3. ファイルシステム（EFS）
- **マウントポイント**: 通常は`/mnt/efs`
- **権限確認**: 書き込みテストで権限を検証
- **フォールバック**: ローカルディレクトリへの切り替え

## 実行と運用

### アプリケーションの起動
```bash
node app.js
```

### PM2での運用（本番環境向け）
```bash
# PM2がインストールされていない場合
npm install -g pm2

# アプリケーションをPM2で起動
pm2 start app.js --name aws-component-checker

# 自動起動設定
pm2 save
pm2 startup

# ログの確認
pm2 logs aws-component-checker
```

### モニタリングとトラブルシューティング

#### 一般的な問題と解決策

1. **Redis接続エラー**:
   - セキュリティグループのインバウンドルール（ポート6379）を確認
   - 転送中の暗号化が有効な場合、`rediss://`プロトコルを使用していることを確認
   - Redis自体が実行中かを確認

2. **データベース接続エラー**:
   - セキュリティグループのインバウンドルール（ポート3306）を確認
   - 認証情報（ユーザー名/パスワード）が正しいか確認
   - データベースが実行中かを確認

3. **EFSアクセスエラー**:
   - EFSがマウントされているか確認: `df -h | grep efs`
   - マウントポイントの権限を確認: `ls -la /mnt/efs`
   - 必要に応じて権限を修正: `sudo chown -R ec2-user:ec2-user /mnt/efs/static`

4. **アプリケーション起動エラー**:
   - ポート3000が既に使用されていないか確認: `netstat -tulpn | grep :3000`
   - 必要なパッケージがすべてインストールされているか確認: `npm list`
   - ログファイルでエラーを確認

## セキュリティ考慮事項

### 運用時の注意点

1. **環境変数**: パスワードなどの機密情報は環境変数として設定し、ソースコード内に直接記述しない
2. **セッションシークレット**: `session({secret: ...})`に強力なランダム文字列を使用
3. **TLS/SSL**: 本番環境ではHTTPS通信を使用し、セッションCookieの`secure`フラグを有効にする
4. **権限最小化**: EC2インスタンスのIAMロールには必要最小限の権限のみ付与
5. **リクエスト検証**: 外部からの入力値（特にファイル名など）を適切に検証

### 改善できる点

1. **認証機能**: 運用環境では適切なユーザー認証を追加
2. **入力サニタイズ**: DB操作などのユーザー入力をさらに厳密にバリデーション
3. **セッションストアの暗号化**: Redis内のセッションデータの暗号化
4. **ログの改善**: 詳細なアクセスログとエラーログの実装

## コードの拡張方法

### 新しいAWSコンポーネントの追加

1. **新しいテスト関数の作成**:
```javascript
async function testNewComponent() {
  try {
    // コンポーネント接続のロジック
    
    // 成功時
    components.newComponent = {
      status: '接続済み',
      details: { /* 詳細情報 */ }
    };
    
    return componentInstance;
  } catch (err) {
    // 失敗時
    console.error('新コンポーネント接続エラー:', err.message);
    components.newComponent = {
      status: '未接続',
      details: { error: err.message }
    };
    return null;
  }
}
```

2. **初期化関数への追加**:
```javascript
async function initializeApp() {
  // 既存のコード...
  
  // 新コンポーネントのテスト
  const newComponentInstance = await testNewComponent();
  
  // 残りのコード...
}
```

3. **UIの拡張**:
   - HTMLテンプレートに新しいコンポーネントのカードを追加
   - クライアントサイドJavaScriptを更新

### 機能の拡張

1. **より詳細なモニタリング**:
   - CloudWatchメトリクスの統合
   - アラート機能の追加

2. **高度な操作**:
   - 各コンポーネントの詳細な設定変更機能
   - パフォーマンステスト機能

3. **ユーザーインターフェース改善**:
   - リアルタイム更新（WebSocketなど）
   - グラフィカルなダッシュボード

## まとめ

このプロジェクトはAWS環境で実行されるNode.jsアプリケーションの健全性チェックを行うシンプルながら強力なツールです。主要なAWSコンポーネントへの接続状態を視覚的に確認でき、基本的なCRUD操作もブラウザから実行できます。

エラー発生時にも代替手段を使って動作を継続する堅牢な設計となっており、AWS環境上のアプリケーション監視の基盤として活用できます。

このドキュメントの知識を基に、アプリケーションの保守、拡張、改善を行うことができます。