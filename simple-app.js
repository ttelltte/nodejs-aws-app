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

// サーバー起動
const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`サーバーが起動しました - ポート: ${PORT}`);
});
