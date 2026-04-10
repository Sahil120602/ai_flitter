const mysql = require("mysql2/promise");

function createDbPool(dbConfig) {
  return mysql.createPool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    waitForConnections: true,
    connectionLimit: dbConfig.connectionLimit,
    queueLimit: 0,
  });
}

async function runQuery(pool, sql, params) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

module.exports = {
  createDbPool,
  runQuery,
};
