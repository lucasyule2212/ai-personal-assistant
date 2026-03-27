import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";

type ResultWithEmail<
  TEmail extends { id: string; subject: string; chunk: string },
> = {
  email: TEmail;
  score: number;
};

export const rerankEmails = async <
  TEmail extends { id: string; subject: string; chunk: string },
>(
  results: ResultWithEmail<TEmail>[],
  query: string
): Promise<ResultWithEmail<TEmail>[]> => {
  const normalizedQuery = query.trim();

  if (results.length === 0 || !normalizedQuery) {
    return [];
  }

  const resultsWithId: Array<ResultWithEmail<TEmail> & { id: number }> =
    results.map((result, index) => ({
      ...result,
      id: index,
    }));

  const resultsAsMap = new Map<number, ResultWithEmail<TEmail>>(
    resultsWithId.map((result) => [result.id, result])
  );

  const rerankedResults = await generateObject({
    model: google("gemini-2.5-flash-lite"),
    system: `
<task-context>
You are a reranker for an email assistant.
Your job is to review candidate email chunks and decide which ones are genuinely useful for answering the user's search query.
</task-context>

<evaluation-criteria>
Prefer chunks that contain direct evidence, concrete facts, or specific details that help answer the query.
Examples of high-value details include names, dates, locations, amounts, plans, decisions, and explicit statements.
</evaluation-criteria>

<rules>
- Be selective. Exclude chunks that are only loosely related or mention similar words without helping answer the query.
- Prefer precise evidence over broad topical similarity.
- If several chunks are relevant, rank the most useful chunks first.
- Only return IDs that appear in the provided candidate list.
- If none of the chunks are meaningfully helpful, return an empty array.
</rules>

<output-format>
Return the IDs in descending relevance order.
Do not invent IDs.
</output-format>
    `,
    schema: z.object({
      resultIds: z
        .array(z.number())
        .describe("IDs of the chunks that are relevant to the query"),
    }),
    prompt: `
<search-query>
${normalizedQuery}
</search-query>

<candidate-chunks>
${resultsWithId
  .map(
    (resultWithId) => `
<chunk id="${resultWithId.id}">
  <subject>${resultWithId.email.subject}</subject>
  <content>
${resultWithId.email.chunk}
  </content>
</chunk>`
  )
  .join("\n")}
</candidate-chunks>

<the-ask>
Return the IDs of the chunks that are genuinely useful for answering the search query.
Order them from most useful to least useful.
</the-ask>
    `,
  });

  console.log("Reranked results:", rerankedResults.object.resultIds);

  return rerankedResults.object.resultIds
    .map((id) => resultsAsMap.get(id))
    .filter(
      (result): result is ResultWithEmail<TEmail> => result !== undefined
    );
};
