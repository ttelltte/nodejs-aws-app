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