import { google } from '@ai-sdk/google';
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateObject,
  streamText,
  type UIMessage,
} from 'ai';
import z from 'zod';
import { searchEmails } from './bm25.ts';

export const KEYWORD_GENERATOR_SYSTEM_PROMPT = `
  You are a helpful email assistant, able to search through emails for information.
  Your job is to generate a list of keywords which will be used to search emails.
`;

type GenerateKeywordsDeps = {
  convertMessagesFn?: typeof convertToModelMessages;
  generateObjectFn?: typeof generateObject;
  model?: unknown;
};

type SearchResult = Awaited<ReturnType<typeof searchEmails>>[number];

type TopSearchResultsDeps = {
  limit?: number;
  searchEmailsFn?: typeof searchEmails;
};

export const generateKeywordsFromMessages = async (
  messages: UIMessage[],
  deps: GenerateKeywordsDeps = {},
) => {
  const {
    convertMessagesFn = convertToModelMessages,
    generateObjectFn = generateObject,
    model = google('gemini-2.5-flash'),
  } = deps;

  const result = await generateObjectFn({
    model: model as never,
    system: KEYWORD_GENERATOR_SYSTEM_PROMPT,
    schema: z.object({
      keywords: z.array(z.string()),
    }),
    messages: convertMessagesFn(messages),
  });

  const keywords = result.object.keywords;

  console.log('Generated keywords:', keywords);

  return keywords;
};

export const getTopSearchResults = async (
  keywords: string[],
  deps: TopSearchResultsDeps = {},
): Promise<SearchResult[]> => {
  const {
    limit = 10,
    searchEmailsFn = searchEmails,
  } = deps;

  const topSearchResults = (await searchEmailsFn(keywords))
    .filter((result) => result.score > 0)
    .slice(0, limit);

  console.log(
    'Top results:',
    topSearchResults.map((result) => result.email?.subject),
  );

  return topSearchResults;
};

export const POST = async (req: Request): Promise<Response> => {
  const body: { messages: UIMessage[] } = await req.json();
  const { messages } = body;

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const keywords =
        await generateKeywordsFromMessages(messages);
      const topSearchResults = await getTopSearchResults(
        keywords,
      );

      const emailSnippets = [
        '## Email Snippets',
        ...topSearchResults.map((result, i) => {
          const from = result.email?.from || 'unknown';
          const to = result.email?.to || 'unknown';
          const subject =
            result.email?.subject || `email-${i + 1}`;
          const body = result.email?.body || '';
          const score = result.score;

          return [
            `### 📧 Email ${i + 1}: [${subject}](#${subject.replace(/[^a-zA-Z0-9]/g, '-')})`,
            `**From:** ${from}`,
            `**To:** ${to}`,
            `**Relevance Score:** ${score.toFixed(3)}`,
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
