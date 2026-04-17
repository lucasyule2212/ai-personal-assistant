import { DB } from "@/lib/persistence-layer";
import { MyMessage } from "./api/chat/route";

export const messagePartsToText = (parts: MyMessage["parts"]) => {
  return parts
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }
    })
    .filter((text): text is string => typeof text === "string")
    .join("\n");
};

export const messageToText = (message: MyMessage) => {
  return `${message.role}: ${messagePartsToText(message.parts)}`;
};

/**
 * Takes the message history and returns a query that can be
 * used as a semantic search query.
 *
 * Includes the most recent message twice to overweight
 * it in the search results.
 */
export const messageHistoryToQuery = (messages: MyMessage[]) => {
  const mostRecentMessage = messages[messages.length - 1];

  const query = [...messages, mostRecentMessage].map(messageToText).join("\n");

  return query;
};

export const chatToText = (chat: DB.Chat): string => {
  const frontmatter = [`Title: ${chat.title}`];

  const summary = chat.llmSummary
    ? [
        `Summary: ${chat.llmSummary.summary}`,
        `What Worked Well: ${chat.llmSummary.whatWorkedWell}`,
        `What To Avoid: ${chat.llmSummary.whatToAvoid}`,
        `Tags: ${chat.llmSummary.tags.join(", ")}`,
      ]
    : [];

  const messages = chat.messages.map(messageToText).join("\n");

  return [...frontmatter, ...summary, messages].join("\n");
};
