import {
  chunkEmails,
  emailChunkToId,
  emailChunkToText,
  loadEmails,
  reciprocalRankFusion,
  searchWithBM25,
  searchWithEmbeddings,
} from "@/app/search";
import { rerankEmails } from "@/app/rerank";
import { convertToModelMessages, tool, UIMessage } from "ai";
import { z } from "zod";

const NUMBER_PASSED_TO_RERANKER = 30;

export const searchTool = (messages: UIMessage[]) =>
  tool({
    description:
      "Search emails using both keyword and semantic search. Returns metadata with snippets only. Use getEmails to fetch full content of specific emails.",
    inputSchema: z.object({
      keywords: z
        .array(z.string())
        .describe(
          "Exact keywords for BM25 search (names, amounts, specific terms)"
        )
        .optional(),
      searchQuery: z
        .string()
        .describe(
          "Natural language query for semantic search (broader concepts)"
        )
        .optional(),
    }),
    execute: async ({ keywords, searchQuery }) => {
      console.log("Keywords:", keywords);
      console.log("Search query:", searchQuery);

      const emails = await loadEmails();
      const emailChunks = await chunkEmails(emails);

      const bm25Results =
        keywords && keywords.length > 0
          ? await searchWithBM25(keywords, emailChunks, emailChunkToText)
          : [];
      const embeddingResults =
        searchQuery && searchQuery.trim()
          ? await searchWithEmbeddings(
              searchQuery,
              emailChunks,
              emailChunkToText
            )
          : [];
      const rrfResults = reciprocalRankFusion(
        [
          bm25Results.slice(0, NUMBER_PASSED_TO_RERANKER),
          embeddingResults.slice(0, NUMBER_PASSED_TO_RERANKER),
        ],
        emailChunkToId
      );

      const conversationHistory = convertToModelMessages(messages).filter(
        (message) => message.role === "user" || message.role === "assistant"
      );
      const query = [keywords?.join(" "), searchQuery]
        .filter(Boolean)
        .join(" ");
      const rerankedResults = await rerankEmails(
        rrfResults.slice(0, NUMBER_PASSED_TO_RERANKER).map((result) => ({
          email: result.item,
          score: result.score,
        })),
        query,
        conversationHistory
      );

      const emailsById = new Map(emails.map((email) => [email.id, email]));
      const seenEmailIds = new Set<string>();
      const topEmails = rerankedResults.flatMap((result) => {
        if (seenEmailIds.has(result.email.emailId)) {
          return [];
        }

        seenEmailIds.add(result.email.emailId);

        const fullEmail = emailsById.get(result.email.emailId);
        const snippet =
          result.email.chunk.slice(0, 150).trim() +
          (result.email.chunk.length > 150 ? "..." : "");

        return [
          {
            id: result.email.emailId,
            threadId: fullEmail?.threadId ?? "",
            subject: result.email.subject,
            from: result.email.from,
            to: result.email.to,
            timestamp: result.email.timestamp,
            score: result.score,
            snippet,
          },
        ];
      });

      console.log("Top emails:", topEmails.length);

      return {
        emails: topEmails,
      };
    },
  });
