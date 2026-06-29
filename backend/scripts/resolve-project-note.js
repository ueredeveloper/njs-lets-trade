'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

async function main() {
  const shortId = process.argv[2];
  const resolution = process.argv[3];
  if (!shortId || !resolution) {
    console.error('Uso: node resolve-project-note.js <short_id> "<resolution>"');
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes no .env');

  const res = await fetch(`${url}/rest/v1/project_notes?short_id=eq.${shortId}`, {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      status: 'resolved',
      resolution,
      resolved_at: new Date().toISOString(),
      blocked_by: null,
    }),
  });

  const body = await res.text();
  if (!res.ok) throw new Error(`Supabase PATCH ${res.status}: ${body}`);
  console.log(JSON.stringify(JSON.parse(body), null, 2));
}

main().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
