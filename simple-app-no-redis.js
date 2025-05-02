const express = require('express');
const app = express();

// ルートエンドポイント
app.get('/', (req, res) => {
  res.send('シンプルなExpressサーバーが動作しています');
});

// ヘルスチェック
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'up', timestamp: new Date() });
});

// ステータスエンドポイント
app.get('/status', (req, res) => {
  res.json({
    server: 'online',
    pid: process.pid,
    uptime: process.uptime(),
    nodeVersion: process.version
  });
});

// サーバー起動時の詳細なログ
const PORT = 3000;
console.log(`ポート ${PORT} でサーバーを起動しようとしています...`);
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`サーバーが起動しました - ポート: ${PORT}`);
  console.log(`プロセスID: ${process.pid}`);
});

// エラーハンドリング
server.on('error', (error) => {
  console.error('サーバー起動エラー:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`ポート ${PORT} は既に使用されています`);
  }
});
