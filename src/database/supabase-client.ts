/**
 * Supabase client initialization and connection management.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('supabase-client');

let client: SupabaseClient | null = null;

/**
 * Get or create the Supabase client singleton.
 * Validates that required environment variables are present.
 */
export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    const missing = [];
    if (!supabaseUrl) missing.push('SUPABASE_URL');
    if (!supabaseKey) missing.push('SUPABASE_KEY');
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
      'Please set them in your .env file or GitHub Actions secrets.'
    );
  }

  logger.info('Initializing Supabase client', { url: supabaseUrl });

  client = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return client;
}

/**
 * Test the Supabase connection by performing a simple query.
 */
export async function testConnection(): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('threat_incidents')
      .select('id')
      .limit(1);

    if (error) {
      logger.error('Supabase connection test failed', { error: error.message });
      return false;
    }

    logger.info('Supabase connection test successful');
    return true;
  } catch (err) {
    logger.error('Supabase connection test threw an exception', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
