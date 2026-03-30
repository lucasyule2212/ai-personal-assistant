import {
  appendToChatMessages,
  createChat,
  DB,
  deleteMemory,
  getChat,
  loadMemories,
  saveMemories,
  updateMemory,
  updateChatTitle,
} from "@/lib/persistence-layer";
import { google } from "@ai-sdk/google";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  generateObject,
  InferUITools,
  safeValidateUIMessages,
  stepCountIs,
  streamText,
  UIMessage,
} from "ai";
import { z } from "zod";
import { filterEmailsTool } from "./filter-tool";
import { generateTitleForChat } from "./generate-title";
import { getEmailsTool } from "./get-emails-tool";
import { searchTool } from "./search-tool";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export type MyMessage = UIMessage<
  never,
  {
    "frontend-action": "refresh-sidebar";
  },
  InferUITools<ReturnType<typeof getTools>>
>;

const getTools = (messages: UIMessage[]) => ({
  search: searchTool(messages),
  filterEmails: filterEmailsTool,
  getEmails: getEmailsTool,
});

const formatMemory = (memory: DB.Memory) => {
  return [
    `ID: ${memory.id}`,
    `Title: ${memory.title}`,
    `Content: ${memory.content}`,
    `Created At: ${memory.createdAt}`,
    `Updated At: ${memory.updatedAt}`,
  ].join("\n");
};

export async function POST(req: Request) {
  const body: {
    messages: UIMessage[];
    id: string;
  } = await req.json();

  const chatId = body.id;

  const validatedMessagesResult = await safeValidateUIMessages<MyMessage>({
    messages: body.messages,
  });

  if (!validatedMessagesResult.success) {
    return new Response(validatedMessagesResult.error.message, { status: 400 });
  }

  const messages = validatedMessagesResult.data;
  const memories = await loadMemories();
  const memoriesText = memories.map(formatMemory).join("\n\n");

  let chat = await getChat(chatId);
  const mostRecentMessage = messages[messages.length - 1];

  if (!mostRecentMessage) {
    return new Response("No messages provided", { status: 400 });
  }

  if (mostRecentMessage.role !== "user") {
    return new Response("Last message must be from the user", {
      status: 400,
    });
  }

  const stream = createUIMessageStream<MyMessage>({
    execute: async ({ writer }) => {
      let generateTitlePromise: Promise<void> | undefined = undefined;

      if (!chat) {
        const newChat = await createChat({
          id: chatId,
          title: "Generating title...",
          initialMessages: messages,
        });
        chat = newChat;

        writer.write({
          type: "data-frontend-action",
          data: "refresh-sidebar",
          transient: true,
        });

        generateTitlePromise = generateTitleForChat(messages)
          .then((title) => {
            return updateChatTitle(chatId, title);
          })
          .then(() => {
            writer.write({
              type: "data-frontend-action",
              data: "refresh-sidebar",
              transient: true,
            });
          });
      } else {
        await appendToChatMessages(chatId, [mostRecentMessage]);
      }

      const result = streamText({
        model: google("gemini-2.5-flash"),
        messages: convertToModelMessages(messages),
        system: `
<task-context>
You are an email assistant that helps users find and understand information from their emails.
</task-context>

<memories>
${memoriesText || "No stored memories yet."}
</memories>

<rules>
- You have THREE tools available: 'search', 'filterEmails', and 'getEmails'
- Follow this multi-step workflow for token efficiency:

  STEP 1 - Browse metadata:
  USE 'filterEmails' when the user wants to:
  - Find emails from/to specific people (e.g., "emails from John", "emails to sarah@example.com")
  - Filter by date ranges (e.g., "emails before January 2024", "emails after last week")
  - Find emails containing exact text (e.g., "emails containing 'invoice'")
  - Any combination of precise filtering criteria

  USE 'search' when the user wants to:
  - Find information semantically (e.g., "emails about the project deadline")
  - Search by concepts or topics (e.g., "discussions about budget")
  - Find answers to questions (e.g., "what did John say about the meeting?")
  - Any query requiring understanding of meaning/context
  - Find people by name or description (e.g., "Mike's biggest client")

  NOTE: 'search' and 'filterEmails' return metadata with snippets only (id, threadId, subject, from, to, timestamp, snippet)

  STEP 2 - Review and select:
  - Review the subjects, metadata, and snippets from search/filter results
  - Identify which specific emails need full content to answer the user's question
  - If snippets contain enough info, answer directly without fetching full content

  STEP 3 - Fetch full content:
  USE 'getEmails' to retrieve full email bodies:
  - Pass array of email IDs you need to read completely
  - Set includeThread=true if you need conversation context (replies, full thread)
  - Set includeThread=false for individual emails

- NEVER answer from your training data - always use tools first
- If the first query doesn't find enough information, try different approaches or tools
- Only after using tools should you formulate your answer based on the results
</rules>

<the-ask>
Here is the user's question. Follow the multi-step workflow above to efficiently find and retrieve the information.
</the-ask>
        `,
        tools: getTools(messages),
        stopWhen: [stepCountIs(10)],
      });

      writer.merge(
        result.toUIMessageStream({
          sendSources: true,
          sendReasoning: true,
        })
      );

      await generateTitlePromise;
    },
    generateId: () => crypto.randomUUID(),
    onFinish: async ({ responseMessage }) => {
      await appendToChatMessages(chatId, [responseMessage]);

      const allMessages = [...messages, responseMessage];
      const memoriesResult = await generateObject({
        model: google("gemini-2.5-flash"),
        schema: z.object({
          updates: z.array(
            z.object({
              id: z
                .string()
                .describe("The ID of the existing memory to update."),
              title: z
                .string()
                .describe("A short title for the updated memory."),
              content: z
                .string()
                .describe(
                  "The updated permanent fact, preference, or long-term detail about the user."
                ),
            })
          ),
          deletions: z
            .array(z.string())
            .describe(
              "Memory IDs to delete because the memory is outdated, incorrect, or no longer relevant."
            ),
          additions: z.array(
            z.object({
              title: z.string().describe("A short title for the new memory."),
              content: z
                .string()
                .describe(
                  "A concise but clear permanent fact, preference, or long-term detail about the user."
                ),
            })
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
${memoriesText || "No stored memories yet."}`,
        messages: convertToModelMessages(allMessages),
      });

      const updates = memoriesResult.object.updates
        .map((memory) => ({
          id: memory.id.trim(),
          title: memory.title.trim(),
          content: memory.content.trim(),
        }))
        .filter((memory) => memory.id && memory.title && memory.content);

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
                candidate.content === memory.content
            ) === index
        );

      console.log("Updates", updates);
      console.log("Deletions", deletions);
      console.log("Additions", additions);

      const filteredDeletions = deletions.filter(
        (deletion) => !updates.some((update) => update.id === deletion)
      );

      for (const update of updates) {
        await updateMemory(update.id, {
          title: update.title,
          content: update.content,
        });
      }

      for (const deletion of filteredDeletions) {
        await deleteMemory(deletion);
      }

      if (additions.length === 0) {
        return;
      }

      const latestMemories = await loadMemories();
      const memoriesToCreate = additions.filter(
        (memory) =>
          !latestMemories.some(
            (existingMemory) =>
              existingMemory.title === memory.title &&
              existingMemory.content === memory.content
          )
      );

      if (memoriesToCreate.length === 0) {
        return;
      }

      const createdAt = new Date().toISOString();
      await saveMemories([
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

  // send sources and reasoning back to the client
  return createUIMessageStreamResponse({
    stream,
  });
}
