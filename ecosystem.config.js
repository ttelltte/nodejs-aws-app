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
    // 環境変数はサーバー側の/etc/environmentから自動的に継承されるので
    // 特別な設定は不要
    error_file: 'logs/pm2-error.log',
    out_file: 'logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    // 再起動設定
    restart_delay: 4000,
    max_restarts: 10,
    min_uptime: '30s',
    // 優雅なシャットダウン
    kill_timeout: 5000,
    listen_timeout: 8000
  }]
};