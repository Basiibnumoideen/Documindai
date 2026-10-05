import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Supabase client initialization
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
// Prioritize SUPABASE_SERVICE_ROLE_KEY if set, otherwise use ANON key
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';

export const supabase = createClient(supabaseUrl, supabaseKey);

// Local fallback store file path (in Vercel serverless, only os.tmpdir() is writable)
const DATA_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), '.data')
  : path.join(process.cwd(), '.data');
const CHUNKS_FILE = path.join(DATA_DIR, 'chunks.json');

// Ensure local fallback store directory exists
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Save chunks locally as backup/fallback if Supabase encounters RLS blocks
export function saveLocalChunks(docName, chunks) {
  try {
    ensureDataDir();
    const cleanDocName = typeof docName === 'string' ? docName.replace(/[/\\]/g, '').trim() : 'document.pdf';
    let existing = [];
    if (fs.existsSync(CHUNKS_FILE)) {
      existing = JSON.parse(fs.readFileSync(CHUNKS_FILE, 'utf8'));
    }
    // Remove previous chunks for the same document to avoid duplicates
    existing = existing.filter(item => item.docName !== cleanDocName);

    const newItems = chunks.map((c, i) => ({
      id: Date.now() + i,
      docName: cleanDocName,
      page: c.page || 1,
      content: c.content,
      vector_embedding: c.vector_embedding,
      created_at: new Date().toISOString()
    }));
    existing.push(...newItems);
    fs.writeFileSync(CHUNKS_FILE, JSON.stringify(existing, null, 2), 'utf8');
    return newItems;
  } catch (err) {
    console.error('Error saving local chunks backup:', err);
    return [];
  }
}

// Retrieve local chunks backup
export function getLocalChunks() {
  try {
    if (fs.existsSync(CHUNKS_FILE)) {
      return JSON.parse(fs.readFileSync(CHUNKS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error reading local chunks backup:', err);
  }
  return [];
}

// Cosine similarity computation between two numerical vectors
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// State-of-the-Art Hybrid Scoring: Combines Dense Vector Similarity (70%) with Lexical Keyword Matching (30%)
export function computeHybridScore(query, chunkContent, vectorSimilarity) {
  const vecScore = Math.max(0, vectorSimilarity || 0);
  if (!query || !chunkContent) return vecScore;

  // Extract non-trivial search keywords
  const terms = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);

  if (terms.length === 0) return vecScore;

  const contentLower = chunkContent.toLowerCase();
  let matches = 0;
  for (const term of terms) {
    if (contentLower.includes(term)) {
      matches++;
    }
  }

  const lexicalScore = matches / terms.length;
  // Blend dense semantics with lexical precision
  return 0.7 * vecScore + 0.3 * lexicalScore;
}

// Robust Google Gemini Embedding with model fallback and exact 768-dim support
export async function getEmbedding(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not defined in environment variables.');
  }

  const models = [
    'models/gemini-embedding-001',
    'models/gemini-embedding-2'
  ];

  let lastError = null;

  for (const model of models) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${model}:embedContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            content: { parts: [{ text: text.trim() }] },
            outputDimensionality: 768
          }),
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!response.ok) {
        let errorMsg = `HTTP ${response.status} ${response.statusText}`;
        try {
          const errBody = await response.json();
          if (errBody?.error?.message) errorMsg = errBody.error.message;
        } catch {
          // ignore non-json error responses
        }
        console.warn(`Gemini embedding attempt for ${model} returned:`, errorMsg);
        lastError = new Error(errorMsg);
        continue;
      }

      const data = await response.json();
      if (data.embedding && data.embedding.values) {
        return data.embedding.values;
      }

      if (data.error) {
        console.warn(`Gemini embedding attempt for ${model} returned:`, data.error.message);
        lastError = new Error(data.error.message);
      }
    } catch (err) {
      console.warn(`Fetch error for embedding model ${model}:`, err.message);
      lastError = err;
    }
  }

  throw lastError || new Error('Failed to generate embedding from Gemini API.');
}

// Robust Google Gemini Answer Generation with multi-model fallback
export async function generateAnswer(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not defined in environment variables.');
  }

  const models = [
    'models/gemini-3.5-flash-lite',
    'models/gemini-3.5-flash',
    'models/gemini-flash-latest'
  ];

  let lastError = null;

  for (const model of models) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
          }),
          signal: AbortSignal.timeout(12000),
        }
      );

      const data = await response.json();
      if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
        return data.candidates[0].content.parts[0].text;
      }

      if (data.error) {
        console.warn(`Gemini generation warning for ${model}:`, data.error.message);
        lastError = new Error(data.error.message);
      }
    } catch (err) {
      console.warn(`Fetch error for generation model ${model}:`, err.message);
      lastError = err;
    }
  }

  throw lastError || new Error('Failed to generate answer from Gemini API.');
}
