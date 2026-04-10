const dotenv = require("dotenv");

dotenv.config();

function getConfig() {
  return {
    azure: {
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2024-02-01",
    },
    db: {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    },
  };
}

function validateConfig(config) {
  const required = [
    ["AZURE_OPENAI_ENDPOINT", config.azure.endpoint],
    ["AZURE_OPENAI_API_KEY", config.azure.apiKey],
    ["AZURE_OPENAI_DEPLOYMENT", config.azure.deployment],
    ["DB_HOST", config.db.host],
    ["DB_USER", config.db.user],
    ["DB_PASSWORD", config.db.password],
    ["DB_NAME", config.db.database],
  ];

  const missing = required.filter((item) => !item[1]).map((item) => item[0]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

module.exports = {
  getConfig,
  validateConfig,
};
