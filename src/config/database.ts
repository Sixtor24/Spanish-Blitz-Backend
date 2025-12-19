/**
 * Database configuration using Neon serverless
 */
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { config } from './env.js';

const NullishQueryFunction = (() => {
  const fn: any = () => {
    throw new Error(
      'No database connection string was provided to `neon()`. Perhaps process.env.DATABASE_URL has not been set'
    );
  };
  fn.transaction = () => {
    throw new Error(
      'No database connection string was provided to `neon()`. Perhaps process.env.DATABASE_URL has not been set'
    );
  };
  return fn;
})();

export const sql: NeonQueryFunction<false, false> = config.DATABASE_URL 
  ? neon(config.DATABASE_URL) 
  : NullishQueryFunction;

