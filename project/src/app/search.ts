import { google } from "@ai-sdk/google";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { cosineSimilarity, embed, embedMany } from "ai";
import fs from "fs/promises";
import BM25 from "okapibm25";
import path from "path";
import {
  ensureEmbeddingsCacheDirectory,
  getCachedEmbedding,
  writeEmbeddingToCache,
} from "./embeddings";

export interface Email {
  id: string;
  threadId: string;
  from: string;
  to: string | string[];
  cc?: string[];
  subject: string;
  body: string;
  timestamp: string;
  inReplyTo?: string;
  references?: string[];
  labels?: string[];
  arcId?: string;
  phaseId?: number;
}

export type EmailChunk = {
  id: string;
  emailId: string;
  subject: string;
  chunk: string;
  index: number;
  totalChunks: number;
  from: string;
  to: string | string[];
  timestamp: string;
};

const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 100,
  separators: ["\n\n", "\n", " ", ""],
});

const RRF_K = 60;

export const chunkEmails = async (emails: Email[]) => {
  const emailsWithChunks: EmailChunk[] = [];

  for (const email of emails) {
    const chunks = await textSplitter.splitText(email.body);

    chunks.forEach((chunk: string, chunkIndex: number) => {
      emailsWithChunks.push({
        id: `${email.id}-${chunkIndex}`,
        emailId: email.id,
        index: chunkIndex,
        subject: email.subject,
        chunk,
        from: email.from,
        to: email.to,
        timestamp: email.timestamp,
        totalChunks: chunks.length,
      });
    });
  }

  return emailsWithChunks;
};

export async function searchWithBM25<T>(
  keywords: string[],
  items: T[],
  toText: (item: T) => string
) {
  const corpus = items.flatMap((item) => toText(item));
  const scores: number[] = (BM25 as any)(corpus, keywords);

  return scores
    .map((score, idx) => ({ score, item: items[idx]! }))
    .sort((a, b) => b.score - a.score);
}

export function reciprocalRankFusion<T>(
  rankings: { item: T; score: number }[][],
  toId: (item: T) => string
): { item: T; score: number }[] {
  const rrfScores = new Map<string, number>();
  const itemMap = new Map<string, T>();

  for (const ranking of rankings) {
    ranking.forEach((result, rank) => {
      const itemId = toId(result.item);
      const currentScore = rrfScores.get(itemId) || 0;
      const contribution = 1 / (RRF_K + rank);

      rrfScores.set(itemId, currentScore + contribution);
      itemMap.set(itemId, result.item);
    });
  }

  return Array.from(rrfScores.entries())
    .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
    .map(([itemId, score]) => ({
      score,
      item: itemMap.get(itemId)!,
    }));
}

export async function searchWithEmbeddings<T>(
  query: string,
  items: T[],
  toText: (item: T) => string
) {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return items.map((item) => ({ score: 0, item }));
  }

  const embeddings = await loadOrGenerateEmbeddings(items, toText);

  const { embedding: queryEmbedding } = await embed({
    model: google.textEmbeddingModel("text-embedding-004"),
    value: normalizedQuery,
  });

  return embeddings
    .map(({ item, embedding }) => ({
      score: cosineSimilarity(queryEmbedding, embedding),
      item,
    }))
    .sort((a, b) => b.score - a.score);
}

export async function searchEmailsWithRRF(query: string, emails: Email[]) {
  const emailChunks = await chunkEmails(emails);
  const bm25Ranking = await searchWithBM25(
    query.toLowerCase().split(" "),
    emailChunks,
    emailChunkToText
  );
  const embeddingsRanking = await searchWithEmbeddings(
    query,
    emailChunks,
    emailChunkToText
  );

  return reciprocalRankFusion([bm25Ranking, embeddingsRanking], emailChunkToId);
}

export async function loadEmails(): Promise<Email[]> {
  const filePath = path.join(process.cwd(), "data", "emails.json");
  const fileContent = await fs.readFile(filePath, "utf-8");
  return JSON.parse(fileContent);
}

export const emailChunkToText = (email: EmailChunk) =>
  `${email.subject} ${email.chunk}`;

export const emailChunkToId = (email: EmailChunk) =>
  `${email.id}-${email.index}`;

export async function loadOrGenerateEmbeddings<T>(
  items: T[],
  toText: (item: T) => string
): Promise<{ item: T; embedding: number[] }[]> {
  await ensureEmbeddingsCacheDirectory();

  const results: { item: T; embedding: number[] }[] = [];
  const uncachedItems: T[] = [];

  for (const item of items) {
    const cachedEmbedding = await getCachedEmbedding(toText(item));

    if (cachedEmbedding) {
      results.push({ item, embedding: cachedEmbedding });
    } else {
      uncachedItems.push(item);
    }
  }

  if (uncachedItems.length > 0) {
    console.log(`Generating embeddings for ${uncachedItems.length} items`);

    const BATCH_SIZE = 99;

    for (let i = 0; i < uncachedItems.length; i += BATCH_SIZE) {
      const batch = uncachedItems.slice(i, i + BATCH_SIZE);
      console.log(
        `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(
          uncachedItems.length / BATCH_SIZE
        )}`
      );

      const { embeddings } = await embedMany({
        model: google.textEmbeddingModel("text-embedding-004"),
        values: batch.map((item) => toText(item)),
      });

      for (let j = 0; j < batch.length; j++) {
        const item = batch[j]!;
        const embedding = embeddings[j];

        await writeEmbeddingToCache(toText(item), embedding);
        results.push({ item, embedding });
      }
    }
  }

  return results;
}
