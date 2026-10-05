import { NextResponse } from 'next/server';
import { PDFParse } from 'pdf-parse';
import { supabase, getEmbedding, generateAnswer, saveLocalChunks } from '@/lib/rag';
import {
  sanitizeFileName,
  validateAndScanPdfBuffer,
  checkRateLimit,
} from '@/lib/security';

export async function POST(request) {
  try {
    // 1. Client IP Identification & Rate Limiting Protection (Anti-DoS)
    const forwarded = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '127.0.0.1';
    const clientIp = forwarded.split(',')[0].trim();

    const rateStatus = checkRateLimit(clientIp, 'upload');
    if (!rateStatus.allowed) {
      console.warn(`[RATE LIMIT EXCEEDED] Upload blocked for IP: ${clientIp}`);
      return NextResponse.json(
        {
          error: `Upload rate limit exceeded. Please wait ${rateStatus.resetSeconds}s before uploading another PDF.`,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(rateStatus.resetSeconds) },
        }
      );
    }

    // 2. Validate Multipart Form-Data
    const data = await request.formData();
    const file = data.get('file');

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No valid file was provided in the upload request.' }, { status: 400 });
    }

    // 3. Filename Sanitization (Anti Path Traversal & Injection)
    const rawFileName = file.name || 'document.pdf';
    const safeDocName = sanitizeFileName(rawFileName);

    // 4. Read File Buffer & Perform Anti-Malware / Magic Bytes Security Scan
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const securityScan = validateAndScanPdfBuffer(buffer, safeDocName);
    if (!securityScan.valid) {
      console.warn(`[SECURITY BLOCKED] Upload for "${safeDocName}": ${securityScan.error}`);
      return NextResponse.json({ error: securityScan.error }, { status: 400 });
    }

    console.log(`--- SECURE PDF PARSE STARTED: "${safeDocName}" (${(buffer.length / 1024).toFixed(1)} KB) ---`);
    const parser = new PDFParse({ data: buffer });
    const parsedData = await parser.getText();
    await parser.destroy();

    const chunks = [];
    const chunkSize = 350; // ~350 words per chunk for optimal semantic depth
    const chunkOverlap = 60; // 60 words overlap to preserve cross-boundary sentences
    const step = chunkSize - chunkOverlap; // 290 words advance per step

    // Page-aware sliding-window chunking
    if (parsedData.pages && parsedData.pages.length > 0) {
      for (const p of parsedData.pages) {
        const pageText = (p.text || '').replace(/\s+/g, ' ').trim();
        if (!pageText) continue;

        const words = pageText.split(' ');
        if (words.length <= chunkSize) {
          if (pageText.length > 10) {
            chunks.push({
              page: p.num || 1,
              content: pageText,
            });
          }
        } else {
          for (let i = 0; i < words.length; i += step) {
            const chunkSlice = words.slice(i, i + chunkSize).join(' ').trim();
            if (chunkSlice.length > 15) {
              chunks.push({
                page: p.num || 1,
                content: chunkSlice,
              });
            }
          }
        }
      }
    }

    // Fallback if pages was empty or unparsed
    if (chunks.length === 0) {
      const fullText = (parsedData.text || '').replace(/\s+/g, ' ').trim();
      const words = fullText.split(' ');
      if (words.length <= chunkSize) {
        if (fullText.length > 10) {
          chunks.push({
            page: 1,
            content: fullText,
          });
        }
      } else {
        for (let i = 0; i < words.length; i += step) {
          const chunkSlice = words.slice(i, i + chunkSize).join(' ').trim();
          if (chunkSlice.length > 15) {
            chunks.push({
              page: 1,
              content: chunkSlice,
            });
          }
        }
      }
    }

    if (chunks.length === 0) {
      return NextResponse.json(
        { error: 'Could not extract text from this PDF. It may be an image scan or password-protected.' },
        { status: 400 }
      );
    }

    // Safety guard against decompression bombs / text flood: cap to 400 chunks max
    const safeChunks = chunks.slice(0, 400);

    console.log(`Extracted ${safeChunks.length} chunks. Generating contextual Gemini embeddings...`);

    // Contextual Embedding: Embed with document and page metadata
    const embeddedChunks = [];
    for (let i = 0; i < safeChunks.length; i++) {
      const chunk = safeChunks[i];
      const contextualText = `Document: ${safeDocName} | Page: ${chunk.page}\n\n${chunk.content}`;
      const vector = await getEmbedding(contextualText);
      embeddedChunks.push({
        ...chunk,
        vector_embedding: vector,
      });
    }

    // Attempt to persist to Supabase
    let supabaseSaved = false;
    let docId = null;

    try {
      const { data: docData, error: docError } = await supabase
        .from('documents')
        .insert([{ name: safeDocName }])
        .select()
        .single();

      if (docError) {
        console.warn('Supabase document insert note (using fallback):', docError.message);
      } else if (docData) {
        docId = docData.id;
        const supabaseRecords = embeddedChunks.map(c => ({
          document_id: docId,
          page: c.page,
          content: c.content,
          vector_embedding: c.vector_embedding,
        }));

        const { error: chunkError } = await supabase.from('chunks').insert(supabaseRecords);
        if (chunkError) {
          console.warn('Supabase chunk insert note (using fallback):', chunkError.message);
        } else {
          supabaseSaved = true;
          console.log(`Saved ${embeddedChunks.length} chunks to Supabase successfully.`);
        }
      }
    } catch (dbErr) {
      console.warn('Database note while saving to Supabase:', dbErr.message);
    }

    // If Supabase failed (e.g. RLS policies not yet set up), save to local backup store
    if (!supabaseSaved) {
      console.log('Using local fallback index for chunks storage...');
      saveLocalChunks(safeDocName, embeddedChunks);
    }

    // 5. Synthesize 4 High-Probability Questions Tailored Specifically to this PDF
    let suggestedQuestions = [
      `Give me a high-level executive summary of "${safeDocName}".`,
      `What are the core conclusions and key takeaways in this document?`,
      `Extract key metrics, statistics, and critical data points.`,
      `What actionable recommendations or next steps are outlined?`,
    ];

    try {
      const sampleText = safeChunks
        .slice(0, 3)
        .map(c => c.content)
        .join('\n\n')
        .slice(0, 1800);

      const questionGenPrompt = `You are an expert AI document research analyst.
Based on the following introductory text from the uploaded document "${safeDocName}", generate 4 high-probability questions that a user or researcher would want to ask about this document.

Strict Requirements:
1. Item 1 MUST be a high-level executive summary request, formatted like: "Give me an executive summary of ${safeDocName} and its core thesis."
2. Items 2, 3, and 4 MUST be specific, highly relevant questions directly reflecting concrete topics, findings, entities, or sections in the document text.
3. Keep each question concise, punchy (under 14 words), and natural.
4. Output ONLY a valid JSON array of 4 strings. No markdown fences, no formatting, no extra explanation. Example: ["Give me an executive summary...", "What were the main...", "How did...", "What are the..."]

Document Text:
${sampleText}`;

      const rawQuestions = await generateAnswer(questionGenPrompt);
      if (rawQuestions) {
        const cleaned = rawQuestions.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed) && parsed.length >= 2) {
          suggestedQuestions = parsed.slice(0, 4);
        }
      }
    } catch (qErr) {
      console.warn('Dynamic question generation note (using fallback):', qErr.message);
    }

    console.log('--- SECURE UPLOAD & EMBEDDING COMPLETE ---');
    return NextResponse.json({
      success: true,
      message: `Indexed ${embeddedChunks.length} chunks from "${safeDocName}"!`,
      totalChunks: embeddedChunks.length,
      docName: safeDocName,
      docId: docId,
      suggestedQuestions,
      storage: supabaseSaved ? 'Supabase pgvector' : 'Local Vector Index (Fallback)',
    });
  } catch (error) {
    console.error('UPLOAD API CRITICAL ERROR:', error);
    return NextResponse.json({ error: error.message || 'Unknown upload error' }, { status: 500 });
  }
}