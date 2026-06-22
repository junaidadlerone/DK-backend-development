/**
 * Embed docs into Supabase pgvector for the chatbot knowledge base.
 *
 * Usage:
 *   cd scripts
 *   npm install
 *   OPENAI_API_KEY=sk-... SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=eyJ... npm run embed
 *
 * Or with a custom docs directory:
 *   DOCS_DIR=/path/to/docs npm run embed
 *
 * Re-run any time you update markdown files in the docs/ folder.
 * The script deletes existing chunks for each file before re-inserting.
 */

import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DOCS_DIR = process.env.DOCS_DIR ?? join(__dirname, "../docs/kb");

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !OPENAI_API_KEY) {
  console.error(
    "Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY"
  );
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ~400 tokens at 4 chars/token
const CHUNK_SIZE = 1600;
const CHUNK_OVERLAP = 200;
const MIN_CHUNK_LENGTH = 60;
const EMBED_BATCH_SIZE = 20;

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length >= MIN_CHUNK_LENGTH) {
      chunks.push(chunk);
    }
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walkDir(full));
    } else if (entry.endsWith(".md") || entry.endsWith(".txt")) {
      results.push(full);
    }
  }
  return results;
}

async function embedFile(filePath: string): Promise<void> {
  const relative = filePath.replace(DOCS_DIR + "/", "");
  const text = readFileSync(filePath, "utf-8");
  const chunks = chunkText(text);

  console.log(`  [${relative}] → ${chunks.length} chunks`);

  // Delete existing chunks for this source file
  const { error: deleteError } = await supabase
    .from("knowledge_chunks")
    .delete()
    .eq("source_file", relative);

  if (deleteError) {
    console.error(`  ✗ Delete failed for ${relative}:`, deleteError.message);
    return;
  }

  if (chunks.length === 0) return;

  // Embed and insert in batches
  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);

    const embedRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: batch,
    });

    const rows = batch.map((content, j) => ({
      source_file: relative,
      content,
      embedding: embedRes.data[j].embedding,
    }));

    const { error: insertError } = await supabase
      .from("knowledge_chunks")
      .insert(rows);

    if (insertError) {
      console.error(`  ✗ Insert failed (batch ${i}):`, insertError.message);
    }
  }
}

async function main(): Promise<void> {
  console.log("📂 Docs directory:", DOCS_DIR);

  let files: string[];
  try {
    files = walkDir(DOCS_DIR);
  } catch {
    console.error(`✗ Could not read docs directory: ${DOCS_DIR}`);
    console.error("  Create the directory and add .md files, then re-run.");
    process.exit(1);
  }

  if (files.length === 0) {
    console.error("✗ No .md or .txt files found in docs directory.");
    process.exit(1);
  }

  console.log(`Found ${files.length} file(s)\n`);

  for (const file of files) {
    await embedFile(file);
  }

  const { count } = await supabase
    .from("knowledge_chunks")
    .select("*", { count: "exact", head: true });

  console.log(`\n✅ Done. Total chunks in knowledge_chunks table: ${count ?? "?"}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
