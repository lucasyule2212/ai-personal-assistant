import { google } from '@ai-sdk/google';
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateObject,
  streamText,
  type UIMessage,
} from 'ai';
import { z } from 'zod';
import { searchEmails } from './search.ts';

export const QUERY_REWRITER_SYSTEM_PROMPT = `
  You are a helpful email assistant, able to search emails for information.
  Your job is to generate a list of keywords which will be used to search the emails.
  You should also generate a search query which will be used for semantic search.
  The keywords should use exact terminology. The search query can be broader and more conceptual.
`;

export const QUERY_REWRITE_SCHEMA = z.object({
  keywords: z
    .array(z.string())
    .describe(
      'A list of keywords to search the emails with. Use these for exact terminology.',
    ),
  searchQuery: z
    .string()
    .describe(
      'A broader search query for semantic search over email embeddings. It can use more general concepts than the keywords.',
    ),
});

type QueryRewrite = z.infer<typeof QUERY_REWRITE_SCHEMA>;

type GenerateSearchTermsDeps = {
  convertMessagesFn?: typeof convertToModelMessages;
  generateObjectFn?: typeof generateObject;
  model?: unknown;
};

type SearchResult = Awaited<
  ReturnType<typeof searchEmails>
>[number];

type TopSearchResultsDeps = {
  limit?: number;
  searchEmailsFn?: typeof searchEmails;
};

export const generateSearchTermsFromMessages = async (
  messages: UIMessage[],
  deps: GenerateSearchTermsDeps = {},
): Promise<QueryRewrite> => {
  const {
    convertMessagesFn = convertToModelMessages,
    generateObjectFn = generateObject,
    model = google('gemini-2.5-flash'),
  } = deps;

  const result = await generateObjectFn({
    model: model as never,
    system: QUERY_REWRITER_SYSTEM_PROMPT,
    schema: QUERY_REWRITE_SCHEMA,
    messages: convertMessagesFn(messages),
  });

  console.log('Keywords:', result.object.keywords);
  console.log('Search Query:', result.object.searchQuery);

  return result.object;
};

export const getTopSearchResults = async (
  searchTerms: QueryRewrite,
  deps: TopSearchResultsDeps = {},
): Promise<SearchResult[]> => {
  const { limit = 5, searchEmailsFn = searchEmails } = deps;

  const searchResults = await searchEmailsFn({
    keywordsForBM25: searchTerms.keywords,
    embeddingsQuery: searchTerms.searchQuery,
  });

  const topSearchResults = searchResults.slice(0, limit);

  console.log(topSearchResults.map((result) => result.email.id));

  return topSearchResults;
};

export const POST = async (req: Request): Promise<Response> => {
  const body: { messages: UIMessage[] } = await req.json();
  const { messages } = body;

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const searchTerms =
        await generateSearchTermsFromMessages(messages);
      const topSearchResults =
        await getTopSearchResults(searchTerms);

      const emailSnippets = [
        '## Email Snippets',
        ...topSearchResults.map((result, i) => {
          const from = result.email?.from || 'unknown';
          const to = result.email?.to || 'unknown';
          const subject =
            result.email?.subject || `email-${i + 1}`;
          const body = result.email?.body || '';

          return [
            `### 📧 Email ${i + 1}: [${subject}](#${subject.replace(/[^a-zA-Z0-9]/g, '-')})`,
            `**From:** ${from}`,
            `**To:** ${to}`,
            body,
            '---',
          ].join('\n\n');
        }),
        '## Instructions',
        "Based on the emails above, please answer the user's question. Always cite your sources using the email subject in markdown format.",
      ].join('\n\n');

      const answer = streamText({
        model: google('gemini-2.5-flash'),
        system: `You are a helpful email assistant that answers questions based on email content.
          You should use the provided emails to answer questions accurately.
          ALWAYS cite sources using markdown formatting with the email subject as the source.
          Be concise but thorough in your explanations.
        `,
        messages: [
          ...convertToModelMessages(messages),
          {
            role: 'user',
            content: emailSnippets,
          },
        ],
      });

      writer.merge(answer.toUIMessageStream());
    },
  });

  return createUIMessageStreamResponse({
    stream,
  });
};
