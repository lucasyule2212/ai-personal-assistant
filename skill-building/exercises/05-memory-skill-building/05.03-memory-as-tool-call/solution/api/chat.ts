import { google } from '@ai-sdk/google';
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateId,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from 'ai';
import { z } from 'zod';
import {
  loadMemories,
  saveMemories,
  deleteMemory,
  updateMemory,
  type DB,
} from './memory-persistence.ts';

export type MyMessage = UIMessage<unknown, {}>;

const MEMORY_TITLE_MAX_LENGTH = 60;

const toStoredMemory = (memory: string) => {
  const normalizedMemory = memory.replace(/\s+/g, ' ').trim();
  const firstSentence = normalizedMemory
    .split(/[.!?]/, 1)[0]
    ?.trim();
  const title = (firstSentence || normalizedMemory).slice(
    0,
    MEMORY_TITLE_MAX_LENGTH,
  );

  return {
    title,
    content: normalizedMemory,
  };
};

const formatMemory = (memory: DB.MemoryItem) => {
  return [
    `ID: ${memory.id}`,
    `Title: ${memory.title}`,
    `Content: ${memory.content}`,
    `Created At: ${memory.createdAt}`,
    `Updated At: ${memory.updatedAt}`,
  ].join('\n');
};

export const POST = async (req: Request): Promise<Response> => {
  const body: { messages: MyMessage[] } = await req.json();
  const { messages } = body;

  const memories = await loadMemories();

  const memoriesText = memories.map(formatMemory).join('\n\n');

  const result = streamText({
    model: google('gemini-2.5-flash-lite'),
    system: `You are a helpful assistant that can answer questions and help with tasks.

    The date is ${new Date().toISOString().split('T')[0]}.

    You have access to the following memories:

    <memories>
    ${memoriesText}
    </memories>

    When users share new personal information, contradict previous information, or ask you to remember/forget things, use the manageMemories tool to update the memory system.

    Guidelines for using the manageMemories tool:
    - CALL IT when: User shares personal details, preferences, facts that should be remembered long-term
    - CALL IT when: User contradicts previous information (use updates field)
    - CALL IT when: User explicitly asks to remember or forget something
    - SKIP IT when: Conversation is casual small talk with no personal information
    - SKIP IT when: User asks temporary/situational questions

    You can batch multiple conversation turns before calling the tool if appropriate.
    `,
    messages: convertToModelMessages(messages),
    tools: {
      manageMemories: tool({
        description:
          'Manage user memories by adding new ones, updating existing ones, or deleting outdated/incorrect ones. Call this when the user shares personal information, contradicts previous statements, or explicitly asks to remember/forget something.',
        inputSchema: z.object({
          updates: z
            .array(
              z.object({
                id: z
                  .string()
                  .describe(
                    'The ID of the existing memory to update',
                  ),
                memory: z
                  .string()
                  .describe('The new memory text'),
              }),
            )
            .describe(
              'Array of existing memories that need to be updated with new information',
            )
            .default([]),
          deletions: z
            .array(z.string())
            .describe(
              'Array of memory IDs that should be deleted (outdated, incorrect, or no longer relevant)',
            )
            .default([]),
          additions: z
            .array(z.string())
            .describe(
              "Array of new memory strings to add to the user's permanent memory",
            )
            .default([]),
        }),
        execute: async ({ updates, deletions, additions }) => {
          const normalizedUpdates = updates
            .map((update) => ({
              id: update.id.trim(),
              memory: update.memory.trim(),
            }))
            .filter((update) => update.id && update.memory);
          const normalizedDeletions = deletions
            .map((deletion) => deletion.trim())
            .filter(Boolean);
          const normalizedAdditions = [
            ...new Set(additions.map((memory) => memory.trim())),
          ].filter(Boolean);

          console.log('Memory tool called:');
          console.log('Updates:', normalizedUpdates);
          console.log('Deletions:', normalizedDeletions);
          console.log('Additions:', normalizedAdditions);

          // Filter out deletions that are being updated
          const filteredDeletions = normalizedDeletions.filter(
            (deletion) =>
              !normalizedUpdates.some(
                (update) => update.id === deletion,
              ),
          );

          // Perform updates
          normalizedUpdates.forEach((update) =>
            updateMemory(
              update.id,
              toStoredMemory(update.memory),
            ),
          );

          // Perform deletions
          filteredDeletions.forEach((deletion) =>
            deleteMemory(deletion),
          );

          // Perform additions
          if (normalizedAdditions.length > 0) {
            const latestMemories = loadMemories();
            const existingMemoryContents = new Set(
              latestMemories.map((memory) => memory.content),
            );
            const now = new Date().toISOString();
            const memoriesToCreate = normalizedAdditions
              .filter(
                (addition) =>
                  !existingMemoryContents.has(addition),
              )
              .map((addition) => {
                const storedMemory = toStoredMemory(addition);

                return {
                  id: generateId(),
                  title: storedMemory.title,
                  content: storedMemory.content,
                  createdAt: now,
                  updatedAt: now,
                };
              });

            if (memoriesToCreate.length > 0) {
              saveMemories([
                ...latestMemories,
                ...memoriesToCreate,
              ]);
            }
          }

          return {
            success: true,
            message: `Updated ${normalizedUpdates.length} memories, deleted ${filteredDeletions.length} memories, added ${normalizedAdditions.length} new memories.`,
          };
        },
      }),
    },
    stopWhen: stepCountIs(5),
  });

  return createUIMessageStreamResponse({
    stream: result.toUIMessageStream(),
  });
};
