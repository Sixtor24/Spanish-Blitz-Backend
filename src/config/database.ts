/**
 * Database configuration using pg for Railway PostgreSQL
 */
import pg from 'pg';
import { config } from './env.js';

if (!config.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Create pg Pool for Railway PostgreSQL
// SSL required for public Railway proxy connection
const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// Create SQL wrapper compatible with existing query syntax
export const sql = async (query: string | TemplateStringsArray, ...params: any[]) => {
  if (typeof query === 'string') {
    // Regular query with parameters - pass them directly to pg
    const result = await pool.query(query, params.length > 0 ? params : undefined);
    return result.rows;
  } else {
    // Tagged template literal - Neon style
    const strings = query as TemplateStringsArray;
    let fullQuery = strings[0];
    const queryParams: any[] = [];
    
    for (let i = 0; i < params.length; i++) {
      queryParams.push(params[i]);
      fullQuery += `$${i + 1}` + strings[i + 1];
    }
    
    const result = await pool.query(fullQuery, queryParams);
    return result.rows;
  }
};

