'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

async function sbGet(filter) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes no .env');

  const res = await fetch(`${url}/rest/v1/project_notes?${filter}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${body}`);
  return JSON.parse(body);
}

async function main() {
  const arg = process.argv[2] || 'njs-lets-trade';

  if (/^[0-9a-f-]{36}$/i.test(arg)) {
    const rows = await sbGet(`id=eq.${arg}`);
    console.log(`TOTAL (id=${arg}):`, rows.length);
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const query = new URLSearchParams({
    project: `eq.${arg}`,
    order: 'created_at.desc',
    limit: '100',
    select: 'id,short_id,project,category,content,status,source,created_at,updated_at,resolved_at,resolution,blocked_by',
  });
  const rows = await sbGet(query.toString());
  console.log(`TOTAL (${arg}):`, rows.length);
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
