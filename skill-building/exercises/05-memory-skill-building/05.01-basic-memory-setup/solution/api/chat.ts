import { google } from '@ai-sdk/google';
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  generateObject,
  streamText,
  type UIMessage,
} from 'ai';
import { z } from 'zod';
import {
  loadMemories,
  saveMemories,
  type DB,
} from './memory-persistence.ts';

export type MyMessage = UIMessage<unknown, {}>;

const formatMemory = (memory: DB.MemoryItem) => {
  return [
    `Title: ${memory.title}`,
    `Content: ${memory.content}`,
    `Created At: ${memory.createdAt}`,
  ].join('\n');
};

export const POST = async (req: Request): Promise<Response> => {
  const body: { messages: MyMessage[] } = await req.json();
  const { messages } = body;

  const memories = await loadMemories();

  const memoriesText = memories.map(formatMemory).join('\n\n');

  const stream = createUIMessageStream<MyMessage>({
    execute: async ({ writer }) => {
      const result = streamText({
        model: google('gemini-2.5-flash-lite'),
        system: `You are a helpful assistant that can answer questions and help with tasks.

        The date is ${new Date().toISOString().split('T')[0]}.

        You have access to the following memories:

        <memories>
        ${memoriesText}
        </memories>
        `,
        messages: convertToModelMessages(messages),
      });

      writer.merge(result.toUIMessageStream());
    },
    onFinish: async (response) => {
      const allMessages = [...messages, ...response.messages];

      const memoriesResult = await generateObject({
        model: google('gemini-2.5-flash-lite'),
        schema: z.object({
          memories: z.array(
            z.object({
              title: z
                .string()
                .describe('A short title for the memory.'),
              content: z
                .string()
                .describe(
                  'A concise but clear permanent fact, preference, or long-term detail about the user.',
                ),
            }),
          ),
        }),
        system: `You are a memory extraction agent.

Extract only permanent, durable memories about the user from the conversation.

Store memories that are likely to remain useful across future conversations:
- stable preferences
- long-term goals
- important personal details
- enduring habits, roles, or responsibilities

Do not store temporary or situational information:
- one-off tasks
- today's requests
- transient moods or states
- short-lived project context unless the user clearly frames it as long-term

Each memory must be:
- specific
- factual
- written about the user
- useful for future personalization

Return only brand new memories that are not already covered by the existing memory list.

Existing memories:
${memoriesText || 'No stored memories yet.'}`,
        messages: convertToModelMessages(allMessages),
      });

      const newMemories = memoriesResult.object.memories
        .map((memory) => ({
          title: memory.title.trim(),
          content: memory.content.trim(),
        }))
        .filter((memory) => memory.title && memory.content)
        .filter(
          (memory) =>
            !memories.some(
              (existingMemory) =>
                existingMemory.title === memory.title &&
                existingMemory.content === memory.content,
            ),
        );

      console.log('newMemories', newMemories);

      if (newMemories.length === 0) {
        return;
      }

      const latestMemories = loadMemories();
      const memoriesToCreate = newMemories.filter(
        (memory) =>
          !latestMemories.some(
            (existingMemory) =>
              existingMemory.title === memory.title &&
              existingMemory.content === memory.content,
          ),
      );

      if (memoriesToCreate.length === 0) {
        return;
      }

      const createdAt = new Date().toISOString();

      saveMemories([
        ...latestMemories,
        ...memoriesToCreate.map((memory) => ({
          id: generateId(),
          title: memory.title,
          content: memory.content,
          createdAt,
          updatedAt: createdAt,
        })),
      ]);
    },
  });

  return createUIMessageStreamResponse({
    stream,
  });
};
