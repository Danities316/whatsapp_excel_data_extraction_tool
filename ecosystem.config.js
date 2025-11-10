module.exports = {
  apps: [
    {
      name: 'whatsapp-api',
      script: 'index.js',
      // API Logs
      out_file: './logs/api-out.log',
      error_file: './logs/api-error.log',
      time: true, // Add timestamp to logs
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'whatsapp-bot',
      script: 'botss.js',
      // BOT Logs
      out_file: './logs/bot-out.log',
      error_file: './logs/bot-error.log',
      time: true, // Add timestamp to logs
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
