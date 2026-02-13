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
export const pool = new pg.Pool({
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
export const sql = async (query: string | TemplateStringsArray, paramsOrFirst?: any[] | any, ...restParams: any[]) => {
  if (typeof query === 'string') {
    // Regular query with parameters array
    // Check if second argument is an array (parameters) or a single value
    const params = Array.isArray(paramsOrFirst) ? paramsOrFirst : (paramsOrFirst !== undefined ? [paramsOrFirst, ...restParams] : []);
    const result = await pool.query(query, params.length > 0 ? params : undefined);
    return result.rows;
  } else {
    // Tagged template literal - Neon style
    const strings = query as TemplateStringsArray;
    const params = paramsOrFirst !== undefined ? [paramsOrFirst, ...restParams] : [];
    let fullQuery = strings[0];
    
    for (let i = 0; i < params.length; i++) {
      fullQuery += `$${i + 1}` + strings[i + 1];
    }
    
    const result = await pool.query(fullQuery, params);
    return result.rows;
  }
};

