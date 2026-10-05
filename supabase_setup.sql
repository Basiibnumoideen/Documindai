-- ==============================================================================
-- Supabase Vector Setup for Chat with PDF (RAG Application)
-- Run this in your Supabase Project Dashboard -> SQL Editor -> New Query -> Run
-- ==============================================================================

-- 1. Enable pgvector extension for high-performance vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Create documents table
CREATE TABLE IF NOT EXISTS public.documents (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::TEXT, now()) NOT NULL
);

-- 3. Create chunks table with vector(768) embeddings
CREATE TABLE IF NOT EXISTS public.chunks (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  document_id BIGINT REFERENCES public.documents(id) ON DELETE CASCADE,
  page INT DEFAULT 1,
  content TEXT NOT NULL,
  vector_embedding vector(768),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::TEXT, now()) NOT NULL
);

-- 4. Enable Row Level Security (RLS) & allow anonymous/public operations
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read and write on documents" ON public.documents;
DROP POLICY IF EXISTS "Allow public read and write on chunks" ON public.chunks;

CREATE POLICY "Allow public read and write on documents"
  ON public.documents FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public read and write on chunks"
  ON public.chunks FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- 5. Create match_chunks similarity search RPC function
CREATE OR REPLACE FUNCTION public.match_chunks (
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id BIGINT,
  document_id BIGINT,
  content TEXT,
  page INT,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    chunks.id,
    chunks.document_id,
    chunks.content,
    chunks.page,
    (1 - (chunks.vector_embedding <=> query_embedding))::float AS similarity
  FROM public.chunks
  WHERE 1 - (chunks.vector_embedding <=> query_embedding) > match_threshold
  ORDER BY chunks.vector_embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
