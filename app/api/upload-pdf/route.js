import { NextResponse } from 'next/server';
import { extractText, getDocumentProxy } from 'unpdf';
import { supabase, getEmbedding, generateAnswer, saveLocalChunks } from '@/lib/rag';
import {
  sanitizeFileName,
  validateAndScanPdfBuffer,
  checkRateLimit,
} from '@/lib/security';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

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

/**
 * Transcribes and extracts all text, tables, figures, numbers, and diagrams from
 * scanned PDFs or image documents using Google Gemini Multimodal Vision.
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {string} docName
 * @returns {Promise<string>}
 */
async function extractWithGeminiVision(buffer, mimeType, docName) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment variables.');
  }

  const base64Data = buffer.toString('base64');
  const models = [
    'models/gemini-3.5-flash-lite',
    'models/gemini-3.5-flash',
  ];

  const prompt = `You are DocuMind AI's Master Document Vision & OCR Intelligence System.
Carefully examine every page, photo, table, diagram, and visual element in this uploaded file ("${docName}").

Perform a comprehensive, ultra-high-fidelity transcription and visual understanding analysis:
1. EXTRACT ALL VISIBLE TEXT: Extract all printed, scanned, and handwritten text, titles, subheadings, paragraphs, footnotes, and headers verbatim.
2. PRESERVE TABLES & LISTS: Convert all tables, matrices, forms, and columnar data into clean GitHub-flavored Markdown tables or structured bullet lists.
3. VISUAL ELEMENTS & DIAGRAMS: If there are charts, diagrams, flowcharts, architectures, photos, or graphs, write a concise factual description under a header "### [Visual/Diagram: Name]" describing the data points, relationships, trends, axes, and takeaways shown.
4. EXACT PAGE DEMARCATION: If the document has multiple pages or sections, clearly demarcate each page with "--- Page 1 ---", "--- Page 2 ---", etc. at the start of each page.
5. NO HALLUCINATION: Transcribe and describe only what is actually visible. Do not make up facts or unstated details.

Begin the extraction now:`;

  let lastError = null;
  for (const model of models) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  {
                    inlineData: {
                      mimeType: mimeType || 'application/pdf',
                      data: base64Data,
                    },
                  },
                ],
              },
            ],
          }),
          signal: AbortSignal.timeout(35000),
        }
      );

      if (!response.ok) {
        let errMsg = `HTTP ${response.status} ${response.statusText}`;
        try {
          const errBody = await response.json();
          if (errBody?.error?.message) errMsg = errBody.error.message;
        } catch {}
        console.warn(`Vision OCR attempt for ${model} returned:`, errMsg);
        lastError = new Error(errMsg);
        continue;
      }

      const data = await response.json();
      const extractedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (extractedText && extractedText.trim().length > 0) {
        return extractedText.trim();
      }

      if (data.error) {
        lastError = new Error(data.error.message);
      }
    } catch (err) {
      console.warn(`Vision OCR fetch error for ${model}:`, err.message);
      lastError = err;
    }
  }

  throw lastError || new Error('Failed to extract text or visual content using Gemini Vision.');
}

/**
 * Splits OCR-extracted text by page demarcations (e.g. '--- Page 1 ---')
 * @param {string} ocrText
 * @returns {Array<{ page: number, text: string }>}
 */
function parseOcrPages(ocrText) {
  if (!ocrText || typeof ocrText !== 'string') return [];

  const pageRegex = /(?:^|\n)\s*(?:---|===|###|##|\[)?\s*Page\s*(\d+)\s*(?:---|===|###|##|\]|:)?\s*(?:\n|$)/gi;
  const matches = [];
  let m;
  while ((m = pageRegex.exec(ocrText)) !== null) {
    matches.push({
      pageNumber: parseInt(m[1], 10),
      index: m.index,
      headerLength: m[0].length,
    });
  }

  if (matches.length === 0) {
    return [{ page: 1, text: ocrText.replace(/\s+/g, ' ').trim() }];
  }

  const pages = [];
  if (matches[0].index > 0) {
    const preText = ocrText.slice(0, matches[0].index).replace(/\s+/g, ' ').trim();
    if (preText.length > 10) {
      pages.push({ page: 1, text: preText });
    }
  }

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const startIndex = current.index + current.headerLength;
    const endIndex = i + 1 < matches.length ? matches[i + 1].index : ocrText.length;
    const pageContent = ocrText.slice(startIndex, endIndex).replace(/\s+/g, ' ').trim();
    if (pageContent.length > 0) {
      pages.push({
        page: current.pageNumber,
        text: pageContent,
      });
    }
  }

  return pages.length > 0 ? pages : [{ page: 1, text: ocrText.replace(/\s+/g, ' ').trim() }];
}

    // 4. Read File Buffer & Perform Anti-Malware / Magic Bytes Security Scan
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const securityScan = validateAndScanPdfBuffer(buffer, safeDocName);
    if (!securityScan.valid) {
      console.warn(`[SECURITY BLOCKED] Upload for "${safeDocName}": ${securityScan.error}`);
      return NextResponse.json({ error: securityScan.error }, { status: 400 });
    }

    const format = securityScan.format || { type: 'pdf', mimeType: 'application/pdf', ext: 'pdf' };
    let pagesList = [];
    let isOcrExtraction = false;

    if (format.type === 'image') {
      console.log(`--- IMAGE SCAN DETECTED: "${safeDocName}" (${(buffer.length / 1024).toFixed(1)} KB) - Engaging Gemini Vision OCR ---`);
      isOcrExtraction = true;
      const ocrResult = await extractWithGeminiVision(buffer, format.mimeType, safeDocName);
      pagesList = parseOcrPages(ocrResult);
    } else {
      console.log(`--- SECURE PDF PARSE STARTED: "${safeDocName}" (${(buffer.length / 1024).toFixed(1)} KB) ---`);
      let totalWords = 0;
      try {
        const pdfProxy = await getDocumentProxy(new Uint8Array(buffer));
        const { text: rawExtractedText } = await extractText(pdfProxy, { mergePages: false });

        if (Array.isArray(rawExtractedText)) {
          pagesList = rawExtractedText.map((t, idx) => ({
            page: idx + 1,
            text: (t || '').replace(/\s+/g, ' ').trim(),
          }));
        } else if (rawExtractedText) {
          pagesList = [{ page: 1, text: String(rawExtractedText).replace(/\s+/g, ' ').trim() }];
        }
        totalWords = pagesList.reduce(
          (acc, p) => acc + (p.text ? p.text.split(' ').filter(Boolean).length : 0),
          0
        );
      } catch (pdfErr) {
        console.warn('Digital unpdf extraction note (engaging OCR fallback):', pdfErr.message);
      }

      // Check if document has sparse or missing text (image scan, phone photo scan, scanned invoice/book)
      const emptyPagesCount = pagesList.filter(p => !p.text || p.text.split(' ').filter(Boolean).length < 5).length;
      const isScanOrImageHeavy =
        totalWords < 25 || (pagesList.length > 0 && emptyPagesCount / pagesList.length >= 0.35);

      if (isScanOrImageHeavy) {
        console.log(
          `Scanned or image-heavy PDF detected (${totalWords} words, ${emptyPagesCount}/${pagesList.length} empty pages). Engaging Gemini Multimodal Vision OCR...`
        );
        try {
          const ocrResult = await extractWithGeminiVision(buffer, 'application/pdf', safeDocName);
          const ocrPages = parseOcrPages(ocrResult);
          if (ocrPages.length > 0 && ocrPages.some(p => p.text.length > 15)) {
            pagesList = ocrPages;
            isOcrExtraction = true;
          }
        } catch (ocrErr) {
          console.warn('Gemini Vision OCR extraction note:', ocrErr.message);
          if (totalWords < 15 && pagesList.every(p => !p.text)) {
            throw new Error(`Failed to extract text from scanned PDF: ${ocrErr.message}`);
          }
        }
      }
    }

    const chunks = [];
    const chunkSize = 350; // ~350 words per chunk for optimal semantic depth
    const chunkOverlap = 60; // 60 words overlap to preserve cross-boundary sentences
    const step = chunkSize - chunkOverlap; // 290 words advance per step

    // Page-aware sliding-window chunking
    for (const p of pagesList) {
      if (!p.text) continue;

      const words = p.text.split(' ').filter(Boolean);
      if (words.length <= chunkSize) {
        if (p.text.length > 10) {
          chunks.push({
            page: p.page,
            content: p.text,
          });
        }
      } else {
        for (let i = 0; i < words.length; i += step) {
          const chunkSlice = words.slice(i, i + chunkSize).join(' ').trim();
          if (chunkSlice.length > 15) {
            chunks.push({
              page: p.page,
              content: chunkSlice,
            });
          }
        }
      }
    }

    // Fallback if pagesList was empty or unparsed
    if (chunks.length === 0) {
      const fullText = pagesList.map(p => p.text).filter(Boolean).join(' ');
      const words = fullText.split(' ').filter(Boolean);
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
        {
          error:
            'Could not extract text or image data from this document. Please ensure the file contains legible content and is not password-protected.',
        },
        { status: 400 }
      );
    }

    // Safety guard against decompression bombs / text flood: cap to 400 chunks max
    const safeChunks = chunks.slice(0, 400);

    console.log(`Extracted ${safeChunks.length} chunks. Generating contextual Gemini embeddings in concurrent batches...`);

    // Contextual Embedding: Embed with document and page metadata in concurrent batches of 5
    const embeddedChunks = [];
    const BATCH_SIZE = 5;
    for (let i = 0; i < safeChunks.length; i += BATCH_SIZE) {
      const batchSlice = safeChunks.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batchSlice.map(async chunk => {
          const contextualText = `Document: ${safeDocName} | Page: ${chunk.page}\n\n${chunk.content}`;
          const vector = await getEmbedding(contextualText);
          return {
            ...chunk,
            vector_embedding: vector,
          };
        })
      );
      embeddedChunks.push(...batchResults);
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
          try {
            await supabase.from('documents').delete().eq('id', docId);
          } catch (delErr) {
            console.warn('Failed to delete orphaned document row:', delErr.message);
          }
          docId = null;
        } else {
          supabaseSaved = true;
          console.log(`Saved ${embeddedChunks.length} chunks to Supabase successfully.`);
        }
      }
    } catch (dbErr) {
      console.warn('Database note while saving to Supabase:', dbErr.message);
      if (!supabaseSaved && docId) {
        try {
          await supabase.from('documents').delete().eq('id', docId);
        } catch {
          // ignore cleanup failure
        }
        docId = null;
      }
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
      extractionMode: isOcrExtraction ? 'Gemini Multimodal Vision OCR' : 'High-Speed Digital Parse',
      storage: supabaseSaved ? 'Supabase pgvector' : 'Local Vector Index (Fallback)',
    });
  } catch (error) {
    console.error('UPLOAD API CRITICAL ERROR:', error);
    return NextResponse.json({ error: error.message || 'Unknown upload error' }, { status: 500 });
  }
}