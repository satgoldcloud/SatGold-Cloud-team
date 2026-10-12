import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

let clientPromise;
export function getClient() {
  if (!clientPromise) {
    clientPromise = fetch('/api/config').then(async (response) => {
      const config = await response.json();
      if (!response.ok) throw new Error(config.error || 'Application configuration is unavailable.');
      return createClient(config.supabaseUrl, config.supabaseAnonKey);
    });
  }
  return clientPromise;
}

export async function api(path, options = {}) {
  const client = await getClient();
  const { data: { session } } = await client.auth.getSession();
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}), ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'The request could not be completed.');
  return body;
}
