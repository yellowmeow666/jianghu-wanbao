import mysql, { type Pool, type PoolOptions } from 'mysql2/promise';

/**
 * Open a mysql2 promise pool from DATABASE_URL
 * (mysql://user:pass@host:port/dbname) or explicit PoolOptions.
 */
export function parseDatabaseUrl(url: string): PoolOptions {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL must be a valid mysql:// URL');
  }
  if (parsed.protocol !== 'mysql:' && parsed.protocol !== 'mysql2:') {
    throw new Error('DATABASE_URL must use mysql:// scheme');
  }
  const database = parsed.pathname.replace(/^\//, '');
  if (!database) {
    throw new Error('DATABASE_URL must include a database name');
  }
  return {
    host: parsed.hostname || '127.0.0.1',
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: false,
    timezone: 'Z',
  };
}

export function openPool(config: PoolOptions | string): Pool {
  const options = typeof config === 'string' ? parseDatabaseUrl(config) : config;
  return mysql.createPool(options);
}

export function createPoolFromEnv(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required (mysql://user:pass@host:port/dbname)');
  }
  return openPool(url);
}
