// aws-params.js - 環境変数から直接取得する簡易版
const getParameters = async () => {
  try {
    console.log('環境変数から設定を読み込んでいます...');
    
    // 環境変数の確認と取得
    const config = {
      elasticache_primary_endpoint: process.env.CACHE_PRIMARY_ENDPOINT,
      elasticache_reader_endpoint: process.env.CACHE_READER_ENDPOINT,
      aurora_writer_endpoint: process.env.AURORA_WRITER_ENDPOINT,
      aurora_reader_endpoint: process.env.AURORA_READER_ENDPOINT,
      aurora_username: process.env.AURORA_USERNAME || 'admin',
      aurora_password: process.env.AURORA_PASSWORD || '',
      efs_filesystem_id: process.env.EFS_ID
    };
    
    // 環境変数のログ表示（パスワードは除く）
    console.log('環境変数確認:');
    console.log(`CACHE_PRIMARY_ENDPOINT: ${config.elasticache_primary_endpoint}`);
    console.log(`AURORA_WRITER_ENDPOINT: ${config.aurora_writer_endpoint}`);
    
    // すべての必要な設定が存在するか確認
    const missingParams = Object.entries(config)
      .filter(([key, value]) => !value && key !== 'aurora_password') // パスワードはオプション
      .map(([key]) => key);
    
    if (missingParams.length > 0) {
      console.warn(`警告: 以下の設定が見つかりません: ${missingParams.join(', ')}`);
    }
    
    console.log('設定の読み込みに成功しました');
    return config;
  } catch (error) {
    console.error('設定の読み込みに失敗しました:', error);
    throw error;
  }
};

module.exports = { getParameters };