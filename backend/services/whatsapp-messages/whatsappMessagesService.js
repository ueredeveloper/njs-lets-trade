'use strict';

/**
 * /services/whatsapp-messages/*
 *
 * CRUD (leitura, edição, deleção) das notas de projeto criadas via WhatsApp —
 * tabela `project_notes` no Supabase, sempre filtrada por source='whatsapp'.
 * Ver backend/scripts/query-project-notes.js e resolve-project-note.js para os
 * scripts de linha de comando equivalentes (mantidos para uso manual/ad-hoc).
 */

const router = require('express').Router();
const supabase = require('../../supabase/client');

const TABLE = 'project_notes';
const SOURCE = 'whatsapp';
const SELECT_COLUMNS = 'id,short_id,project,category,content,status,source,created_at,updated_at,resolved_at,resolution,blocked_by';
const EDITABLE_FIELDS = ['content', 'category', 'status', 'project', 'resolution', 'blocked_by'];
const UUID_RE = /^[0-9a-f-]{36}$/i;

// Se Supabase não estiver configurado, retorna 503 direto em vez de deixar o
// client falhar com URL vazia (mesma proteção usada em supabaseService.js).
const SUPABASE_OK = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
router.use((req, res, next) => {
  if (!SUPABASE_OK) return res.status(503).json({ error: 'Supabase não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.' });
  next();
});

function sbError(res, error, context = '') {
  console.error(`[whatsapp-messages] ${context}:`, error.message || error);
  res.status(500).json({ error: error.message || String(error) });
}

/** :id aceita tanto o uuid completo quanto o short_id (ex: "93ij0k"). */
function idFilter(query, id) {
  return UUID_RE.test(id) ? query.eq('id', id) : query.eq('short_id', id);
}

// GET /services/whatsapp-messages?project=&status=&category=&limit=100
router.get('/whatsapp-messages', async (req, res) => {
  const { project, status, category, limit = '100' } = req.query;

  let query = supabase
    .from(TABLE)
    .select(SELECT_COLUMNS)
    .eq('source', SOURCE)
    .order('created_at', { ascending: false })
    .limit(Math.min(parseInt(limit, 10) || 100, 500));

  if (project) query = query.eq('project', project);
  if (status) query = query.eq('status', status);
  if (category) query = query.eq('category', category);

  const { data, error } = await query;
  if (error) return sbError(res, error, 'GET whatsapp-messages');
  res.json(data ?? []);
});

// GET /services/whatsapp-messages/:id  (uuid ou short_id)
router.get('/whatsapp-messages/:id', async (req, res) => {
  const { data, error } = await idFilter(
    supabase.from(TABLE).select(SELECT_COLUMNS).eq('source', SOURCE),
    req.params.id,
  ).maybeSingle();
  if (error) return sbError(res, error, 'GET whatsapp-messages/:id');
  if (!data) return res.status(404).json({ error: 'not found' });
  res.json(data);
});

// PATCH /services/whatsapp-messages/:id  { content?, category?, status?, project?, resolution?, blocked_by? }
router.patch('/whatsapp-messages/:id', async (req, res) => {
  const updates = {};
  for (const field of EDITABLE_FIELDS) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }
  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: `Nenhum campo editável enviado (permitidos: ${EDITABLE_FIELDS.join(', ')})` });
  }
  updates.updated_at = new Date().toISOString();

  // Mesma regra de resolve-project-note.js: marcar status=resolved carimba resolved_at
  // e limpa blocked_by, a menos que o body já tenha enviado esses campos explicitamente.
  if (updates.status === 'resolved' && req.body.resolved_at === undefined) {
    updates.resolved_at = new Date().toISOString();
  }
  if (updates.status && updates.status !== 'resolved' && req.body.resolved_at === undefined) {
    updates.resolved_at = null;
  }

  const { data, error } = await idFilter(
    supabase.from(TABLE).update(updates).eq('source', SOURCE),
    req.params.id,
  ).select(SELECT_COLUMNS).maybeSingle();
  if (error) return sbError(res, error, 'PATCH whatsapp-messages/:id');
  if (!data) return res.status(404).json({ error: 'not found' });
  res.json(data);
});

// DELETE /services/whatsapp-messages/:id  (uuid ou short_id)
router.delete('/whatsapp-messages/:id', async (req, res) => {
  const { data: existing, error: findErr } = await idFilter(
    supabase.from(TABLE).select('id').eq('source', SOURCE),
    req.params.id,
  ).maybeSingle();
  if (findErr) return sbError(res, findErr, 'DELETE whatsapp-messages/:id (find)');
  if (!existing) return res.status(404).json({ error: 'not found' });

  const { error } = await supabase.from(TABLE).delete().eq('id', existing.id);
  if (error) return sbError(res, error, 'DELETE whatsapp-messages/:id');
  res.json({ deleted: existing.id });
});

module.exports = router;
