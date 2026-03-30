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
  deleteMemory,
  updateMemory,
  type DB,
} from './memory-persistence.ts';

export type MyMessage = UIMessage<unknown, {}>;

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
        model: google('gemini-2.5-flash'),
        schema: z.object({
          updates: z
            .array(
              z.object({
                id: z
                  .string()
                  .describe(
                    'The ID of the existing memory to update',
                  ),
                title: z
                  .string()
                  .describe(
                    'A short title for the updated memory.',
                  ),
                content: z
                  .string()
                  .describe(
                    'The updated permanent fact, preference, or long-term detail about the user.',
                  ),
              }),
            )
            .describe(
              'Array of existing memories that need to be updated with new information',
            ),
          deletions: z
            .array(z.string())
            .describe(
              'Array of memory IDs that should be deleted (outdated, incorrect, or no longer relevant)',
            ),
          additions: z
            .array(
              z.object({
                title: z
                  .string()
                  .describe('A short title for the new memory.'),
                content: z
                  .string()
                  .describe(
                    'A concise but clear permanent fact, preference, or long-term detail about the user.',
                  ),
              }),
            )
            .describe(
              "Array of new memories to add to the user's permanent memory",
            ),
        }),
        system: `You are a memory management agent.

Review the conversation and manage the user's durable memories.

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

MEMORY MANAGEMENT TASKS:
1. ADDITIONS: Extract new permanent memories from this conversation that are not already covered by existing memories.
2. UPDATES: Update existing memories when the user clarifies them, changes preferences, or provides information that contradicts an existing memory.
3. DELETIONS: Delete existing memories when they are outdated, incorrect, or no longer relevant.

When to update:
- user preferences change
- new information contradicts old information
- clarifications improve an existing memory

When to delete:
- information is outdated
- information is incorrect
- information is no longer relevant

Each memory should be:
- specific
- factual
- written about the user
- useful for future personalization

For updates and additions, return both title and content.
For deletions, return only the memory ID.

If no changes are needed, return empty arrays for updates, deletions, and additions.

Existing memories:
${memoriesText || 'No stored memories yet.'}`,
        messages: convertToModelMessages(allMessages),
      });

      const updates = memoriesResult.object.updates
        .map((memory) => ({
          id: memory.id.trim(),
          title: memory.title.trim(),
          content: memory.content.trim(),
        }))
        .filter(
          (memory) =>
            memory.id && memory.title && memory.content,
        );

      const deletions = memoriesResult.object.deletions
        .map((memoryId) => memoryId.trim())
        .filter(Boolean);

      const additions = memoriesResult.object.additions
        .map((memory) => ({
          title: memory.title.trim(),
          content: memory.content.trim(),
        }))
        .filter((memory) => memory.title && memory.content)
        .filter(
          (memory, index, allAdditions) =>
            allAdditions.findIndex(
              (candidate) =>
                candidate.title === memory.title &&
                candidate.content === memory.content,
            ) === index,
        );

      console.log('Updates', updates);
      console.log('Deletions', deletions);
      console.log('Additions', additions);

      // Only delete memories that are not being updated
      const filteredDeletions = deletions.filter(
        (deletion) =>
          !updates.some((update) => update.id === deletion),
      );

      updates.forEach((update) =>
        updateMemory(update.id, {
          title: update.title,
          content: update.content,
        }),
      );

      filteredDeletions.forEach((deletion) =>
        deleteMemory(deletion),
      );

      if (additions.length === 0) {
        return;
      }

      const latestMemories = loadMemories();
      const memoriesToCreate = additions.filter(
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
