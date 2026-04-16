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
import { searchMemories } from "@/app/memory-search";
import { google } from "@ai-sdk/google";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  InferUITools,
  safeValidateUIMessages,
  stepCountIs,
  streamText,
  tool,
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

const MEMORY_TITLE_MAX_LENGTH = 60;
const MEMORIES_TO_INCLUDE = 4;

const toStoredMemory = (memory: string) => {
  const normalizedMemory = memory.replace(/\s+/g, " ").trim();
  const firstSentence = normalizedMemory.split(/[.!?]/, 1)[0]?.trim();
  const title = (firstSentence || normalizedMemory).slice(
    0,
    MEMORY_TITLE_MAX_LENGTH
  );

  return {
    title,
    content: normalizedMemory,
  };
};

const manageMemoriesTool = tool({
  description:
    "Manage durable user memories. Call this when the user shares lasting personal details, changes or contradicts earlier facts, or explicitly asks you to remember or forget something.",
  inputSchema: z.object({
    updates: z
      .array(
        z.object({
          id: z
            .string()
            .describe("The ID of the existing memory that should be updated."),
          memory: z
            .string()
            .describe(
              "The new memory text that should replace the existing one."
            ),
        })
      )
      .default([]),
    deletions: z
      .array(z.string())
      .describe(
        "Memory IDs to delete because they are outdated, incorrect, or no longer relevant."
      )
      .default([]),
    additions: z
      .array(z.string())
      .describe(
        "New durable memory strings to add for the user when they share important long-term information."
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

    console.log("Memory tool called:");
    console.log("Updates:", normalizedUpdates);
    console.log("Deletions:", normalizedDeletions);
    console.log("Additions:", normalizedAdditions);

    const filteredDeletions = normalizedDeletions.filter(
      (deletion) => !normalizedUpdates.some((update) => update.id === deletion)
    );

    for (const update of normalizedUpdates) {
      await updateMemory(update.id, toStoredMemory(update.memory));
    }

    for (const deletion of filteredDeletions) {
      await deleteMemory(deletion);
    }

    if (normalizedAdditions.length > 0) {
      const latestMemories = await loadMemories();
      const existingMemoryContents = new Set(
        latestMemories.map((memory) => memory.content)
      );
      const now = new Date().toISOString();
      const memoriesToCreate = normalizedAdditions
        .filter((memory) => !existingMemoryContents.has(memory))
        .map((memory) => {
          const storedMemory = toStoredMemory(memory);

          return {
            id: generateId(),
            title: storedMemory.title,
            content: storedMemory.content,
            createdAt: now,
            updatedAt: now,
          };
        });

      if (memoriesToCreate.length > 0) {
        await saveMemories([...latestMemories, ...memoriesToCreate]);
      }
    }

    return {
      success: true,
      message: `Updated ${normalizedUpdates.length} memories, deleted ${filteredDeletions.length} memories, added ${normalizedAdditions.length} memories.`,
    };
  },
});

const getTools = (messages: UIMessage[]) => ({
  search: searchTool(messages),
  filterEmails: filterEmailsTool,
  getEmails: getEmailsTool,
  manageMemories: manageMemoriesTool,
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
  const mostRecentMessage = messages[messages.length - 1];

  if (!mostRecentMessage) {
    return new Response("No messages provided", { status: 400 });
  }

  if (mostRecentMessage.role !== "user") {
    return new Response("Last message must be from the user", {
      status: 400,
    });
  }

  const foundMemories = await searchMemories({
    messages,
  });

  const memoriesText = foundMemories
    .slice(0, MEMORIES_TO_INCLUDE)
    .map((memory) => formatMemory(memory.item))
    .join("\n\n");

  console.log("Retrieved memories:\n", memoriesText || "No relevant memories.");

  let chat = await getChat(chatId);

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
${memoriesText || "No relevant stored memories were retrieved for this conversation."}
</memories>

<rules>
- You have FOUR tools available: 'search', 'filterEmails', 'getEmails', and 'manageMemories'
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
- Use 'manageMemories' when the user shares durable personal information, changes a previous fact or preference, or explicitly asks you to remember or forget something
- Skip 'manageMemories' for casual small talk, temporary requests, and situational details that are unlikely to matter later
- It is fine to batch memory updates from multiple recent turns into a single 'manageMemories' call when that is more efficient
</rules>

<the-ask>
Here is the user's question. Follow the multi-step workflow above to efficiently find and retrieve the information.
</the-ask>
        `,
        tools: getTools(messages),
        stopWhen: stepCountIs(5),
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
    },
  });

  // send sources and reasoning back to the client
  return createUIMessageStreamResponse({
    stream,
  });
}
