-- Adiciona coluna gate_added em favorites_gate
-- Cole no SQL Editor do Supabase e execute.

ALTER TABLE public.favorites_gate
  ADD COLUMN IF NOT EXISTS gate_added boolean NOT NULL DEFAULT false;
