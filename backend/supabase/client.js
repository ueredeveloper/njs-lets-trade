'use strict';

const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn('[supabase] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidos — endpoints /services/sb/* não funcionarão.');
}

const supabase = createClient(url ?? '', key ?? '', {
  auth: { persistSession: false },
});

module.exports = supabase;
