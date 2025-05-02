// aws-params.js - 環境変数版
const getParameters = async () => {
    try {
      console.log('環境変数から設定を読み込んでいます...');
      
      // 環境変数から設定を読み込む
      const config = {
        elasticache_primary_endpoint: process.env.ELASTICACHE_PRIMARY_ENDPOINT,
        elasticache_reader_endpoint: process.env.ELASTICACHE_READER_ENDPOINT,
        aurora_writer_endpoint: process.env.AURORA_WRITER_ENDPOINT,
        aurora_reader_endpoint: process.env.AURORA_READER_ENDPOINT,
        aurora_username: process.env.AURORA_USERNAME,
        aurora_password: process.env.AURORA_PASSWORD,
        efs_filesystem_id: process.env.EFS_FILESYSTEM_ID
      };
      
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