const path = require('path');
const PM2_ENV = process.env.PM2_ENV || process.env.NODE_ENV || 'production';
const envFile = path.join(__dirname, `.env.${PM2_ENV}`);

module.exports = {
  apps: [
    {
      name: process.env.PM2_APP_NAME || "lead-app",
      script: './server.js',
      cwd: __dirname,
      instances: 2,
      exec_mode: 'cluster',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      // Pass --env-file flag with absolute path to Node.js
      node_args: `--env-file=${envFile}`,
      env: {
        NODE_ENV: PM2_ENV,
      },
      env_development: {
        NODE_ENV: 'development',
        instances: 1,
        exec_mode: 'fork'
      },
      [`env_${PM2_ENV}`]: {
        NODE_ENV: PM2_ENV,
      }
    }
  ],
};
