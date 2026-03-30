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

export async function searchWithBM25(
  keywords: string[],
  emailChunks: EmailChunk[]
) {
  const corpus = emailChunks.map((emailChunk) => emailChunkToText(emailChunk));
  const scores: number[] = (BM25 as any)(corpus, keywords);

  return scores
    .map((score, idx) => ({ score, email: emailChunks[idx] }))
    .sort((a, b) => b.score - a.score);
}

export function reciprocalRankFusion(
  rankings: { email: EmailChunk; score: number }[][]
): { email: EmailChunk; score: number }[] {
  const rrfScores = new Map<string, number>();
  const emailMap = new Map<string, EmailChunk>();

  for (const ranking of rankings) {
    ranking.forEach((item, rank) => {
      const currentScore = rrfScores.get(item.email.id) || 0;
      const contribution = 1 / (RRF_K + rank);

      rrfScores.set(item.email.id, currentScore + contribution);
      emailMap.set(item.email.id, item.email);
    });
  }

  return Array.from(rrfScores.entries())
    .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
    .map(([emailId, score]) => ({
      score,
      email: emailMap.get(emailId)!,
    }));
}

export async function searchWithEmbeddings(
  query: string,
  emailChunks: EmailChunk[]
) {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return emailChunks.map((email) => ({ score: 0, email }));
  }

  const emailEmbeddings = await loadOrGenerateEmbeddings(emailChunks);
  const emailChunkById = new Map(emailChunks.map((email) => [email.id, email]));

  const { embedding: queryEmbedding } = await embed({
    model: google.textEmbeddingModel("text-embedding-004"),
    value: normalizedQuery,
  });

  return emailEmbeddings
    .map(({ id, embedding }) => {
      const email = emailChunkById.get(id);

      if (!email) {
        return null;
      }

      return {
        score: cosineSimilarity(queryEmbedding, embedding),
        email,
      };
    })
    .filter((result) => result !== null)
    .sort((a, b) => b.score - a.score);
}

export async function searchWithRRF(query: string, emails: Email[]) {
  const emailChunks = await chunkEmails(emails);
  const bm25Ranking = await searchWithBM25(
    query.toLowerCase().split(" "),
    emailChunks
  );
  const embeddingsRanking = await searchWithEmbeddings(query, emailChunks);

  return reciprocalRankFusion([bm25Ranking, embeddingsRanking]);
}

export async function loadEmails(): Promise<Email[]> {
  const filePath = path.join(process.cwd(), "data", "emails.json");
  const fileContent = await fs.readFile(filePath, "utf-8");
  return JSON.parse(fileContent);
}

export const emailChunkToText = (email: EmailChunk) =>
  `${email.subject} ${email.chunk}`;

export async function loadOrGenerateEmbeddings(
  emailChunks: EmailChunk[]
): Promise<{ id: string; embedding: number[] }[]> {
  await ensureEmbeddingsCacheDirectory();

  const results: { id: string; embedding: number[] }[] = [];
  const uncachedEmailChunks: EmailChunk[] = [];

  for (const emailChunk of emailChunks) {
    const cachedEmbedding = await getCachedEmbedding(
      emailChunkToText(emailChunk)
    );

    if (cachedEmbedding) {
      results.push({ id: emailChunk.id, embedding: cachedEmbedding });
    } else {
      uncachedEmailChunks.push(emailChunk);
    }
  }

  if (uncachedEmailChunks.length > 0) {
    console.log(
      `Generating embeddings for ${uncachedEmailChunks.length} emails`
    );

    const BATCH_SIZE = 99;

    for (let i = 0; i < uncachedEmailChunks.length; i += BATCH_SIZE) {
      const batch = uncachedEmailChunks.slice(i, i + BATCH_SIZE);
      console.log(
        `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(
          uncachedEmailChunks.length / BATCH_SIZE
        )}`
      );

      const { embeddings } = await embedMany({
        model: google.textEmbeddingModel("text-embedding-004"),
        values: batch.map((emailChunk) => emailChunkToText(emailChunk)),
      });

      for (let j = 0; j < batch.length; j++) {
        const emailChunk = batch[j];
        const embedding = embeddings[j];

        await writeEmbeddingToCache(emailChunkToText(emailChunk), embedding);

        results.push({ id: emailChunk.id, embedding });
      }
    }
  }

  return results;
}
