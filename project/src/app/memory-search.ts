import { google } from "@ai-sdk/google";
import { DB, loadMemories } from "@/lib/persistence-layer";
import { cosineSimilarity, embed } from "ai";
import BM25 from "okapibm25";
import {
  ensureEmbeddingsCacheDirectory,
  getCachedEmbedding,
  writeEmbeddingToCache,
} from "./embeddings";

const RRF_K = 60;

export const memoryToText = (memory: DB.Memory) =>
  `${memory.title}: ${memory.content}`;

const searchMemoriesWithBM25 = async (
  memories: DB.Memory[],
  keywords: string[]
) => {
  if (memories.length === 0 || keywords.length === 0) {
    return [] as { memory: DB.Memory; score: number }[];
  }

  const scores: number[] = (BM25 as any)(
    memories.map(memoryToText),
    keywords
  );

  return scores
    .map((score, index) => ({
      score,
      memory: memories[index]!,
    }))
    .sort((a, b) => b.score - a.score);
};

const loadOrGenerateMemoryEmbeddings = async (memories: DB.Memory[]) => {
  await ensureEmbeddingsCacheDirectory();

  const results: { memory: DB.Memory; embedding: number[] }[] = [];
  const uncachedMemories: DB.Memory[] = [];

  for (const memory of memories) {
    const text = memoryToText(memory);
    const cachedEmbedding = await getCachedEmbedding(text);

    if (cachedEmbedding) {
      results.push({ memory, embedding: cachedEmbedding });
      continue;
    }

    uncachedMemories.push(memory);
  }

  for (const memory of uncachedMemories) {
    const text = memoryToText(memory);
    const { embedding } = await embed({
      model: google.textEmbeddingModel("text-embedding-004"),
      value: text,
    });

    await writeEmbeddingToCache(text, embedding);
    results.push({ memory, embedding });
  }

  return results;
};

const searchMemoriesWithEmbeddings = async (
  memories: DB.Memory[],
  query: string
) => {
  const normalizedQuery = query.trim();

  if (memories.length === 0 || !normalizedQuery) {
    return [] as { memory: DB.Memory; score: number }[];
  }

  const memoryEmbeddings = await loadOrGenerateMemoryEmbeddings(memories);
  const { embedding: queryEmbedding } = await embed({
    model: google.textEmbeddingModel("text-embedding-004"),
    value: normalizedQuery,
  });

  return memoryEmbeddings
    .map(({ memory, embedding }) => ({
      memory,
      score: cosineSimilarity(queryEmbedding, embedding),
    }))
    .sort((a, b) => b.score - a.score);
};

const reciprocalRankFusion = (
  rankings: { memory: DB.Memory; score: number }[][]
) => {
  const scores = new Map<string, number>();
  const memoryById = new Map<string, DB.Memory>();

  for (const ranking of rankings) {
    ranking.forEach((item, rank) => {
      const currentScore = scores.get(item.memory.id) ?? 0;
      scores.set(item.memory.id, currentScore + 1 / (RRF_K + rank));
      memoryById.set(item.memory.id, item.memory);
    });
  }

  return Array.from(scores.entries())
    .sort(([, left], [, right]) => right - left)
    .map(([memoryId, score]) => ({
      score,
      memory: memoryById.get(memoryId)!,
    }));
};

export const searchMemories = async (opts: {
  searchQuery: string;
  keywordsForBM25: string[];
}) => {
  const memories = await loadMemories();

  if (memories.length === 0) {
    return [] as { memory: DB.Memory; score: number }[];
  }

  const [embeddingResults, bm25Results] = await Promise.all([
    searchMemoriesWithEmbeddings(memories, opts.searchQuery),
    searchMemoriesWithBM25(memories, opts.keywordsForBM25),
  ]);

  if (embeddingResults.length === 0) {
    return bm25Results;
  }

  if (bm25Results.length === 0) {
    return embeddingResults;
  }

  return reciprocalRankFusion([embeddingResults, bm25Results]);
};
