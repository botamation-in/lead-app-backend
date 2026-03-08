const path = require('path');
const PM2_ENV = process.env.PM2_ENV || process.env.NODE_ENV || 'production';
const envFile = path.join(__dirname, '.env.' + PM2_ENV);

module.exports = {
  apps: [
    {
      name: process.env.PM2_APP_NAME || "leadapp",
      script: './server.js',
      cwd: __dirname,
      instances: 2,
      exec_mode: 'cluster',
      interpreter_args: '--env-file=' + envFile,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '500M',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      combine_logs: true,
      env: {
        NODE_ENV: PM2_ENV,
      },
      env_development: {
        NODE_ENV: 'development',
        instances: 1,
        exec_mode: 'fork'
      },
      [`env_${PM2_ENV}`]: {
        NODE_ENV: 'production',
      }
    }
  ],
};
