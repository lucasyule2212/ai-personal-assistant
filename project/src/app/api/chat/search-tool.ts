import {
  chunkEmails,
  loadEmails,
  reciprocalRankFusion,
  searchWithBM25,
  searchWithEmbeddings,
} from "@/app/search";
import { rerankEmails } from "@/app/rerank";
import { tool } from "ai";
import { z } from "zod";

const NUMBER_PASSED_TO_RERANKER = 30;

export const searchTool = tool({
  description:
    "Search emails using both keyword and semantic search. Returns most relevant emails ranked by reciprocal rank fusion.",
  inputSchema: z.object({
    keywords: z
      .array(z.string())
      .describe(
        "Exact keywords for BM25 search (names, amounts, specific terms)"
      )
      .optional(),
    searchQuery: z
      .string()
      .describe("Natural language query for semantic search (broader concepts)")
      .optional(),
  }),
  execute: async ({ keywords, searchQuery }) => {
    console.log("Keywords:", keywords);
    console.log("Search query:", searchQuery);

    const emails = await loadEmails();
    const emailChunks = await chunkEmails(emails);

    const bm25Results =
      keywords && keywords.length > 0
        ? await searchWithBM25(keywords, emailChunks)
        : [];
    const embeddingResults =
      searchQuery && searchQuery.trim()
        ? await searchWithEmbeddings(searchQuery, emailChunks)
        : [];
    const rrfResults = reciprocalRankFusion([
      bm25Results.slice(0, NUMBER_PASSED_TO_RERANKER),
      embeddingResults.slice(0, NUMBER_PASSED_TO_RERANKER),
    ]);

    const query = [keywords?.join(" "), searchQuery].filter(Boolean).join(" ");
    const rerankedResults = await rerankEmails(
      rrfResults.slice(0, NUMBER_PASSED_TO_RERANKER),
      query
    );

    const topEmails = rerankedResults.map((result) => ({
      id: result.email.id,
      from: result.email.from,
      subject: result.email.subject,
      to: result.email.to,
      body: result.email.chunk,
      timestamp: result.email.timestamp,
      chunkIndex: result.email.index,
      totalChunks: result.email.totalChunks,
      score: result.score,
    }));

    console.log("Top emails:", topEmails.length);

    return {
      emails: topEmails,
    };
  },
});
