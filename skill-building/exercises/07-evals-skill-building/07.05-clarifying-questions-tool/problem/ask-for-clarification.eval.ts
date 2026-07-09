import { createUIMessageFixture } from '#shared/create-ui-message-fixture.ts';
import { google } from '@ai-sdk/google';
import { stepCountIs } from 'ai';
import { evalite } from 'evalite';
import { runAgent } from './agent.ts';
import { wrapAISDKModel } from 'evalite/ai-sdk';

evalite('Ask For Clarification Evaluation', {
  data: [
    {
      input: createUIMessageFixture('Book a flight to Paris'),
    },
    {
      input: createUIMessageFixture('Send John an email'),
    },
    {
      input: createUIMessageFixture(
        'Create an invoice for the client',
      ),
    },
    {
      input: createUIMessageFixture('Set a reminder'),
    },
    {
      input: createUIMessageFixture('Translate this text'),
    },
    {
      input: createUIMessageFixture('Check the weather'),
    },
    {
      input: createUIMessageFixture(
        'Schedule a social media post',
      ),
    },
    {
      input: createUIMessageFixture('Create a task for me'),
    },
    {
      input: createUIMessageFixture('Search my calendar'),
    },
    {
      input: createUIMessageFixture('Compress a file'),
    },
  ],
  task: async (input) => {
    const result = runAgent(
      wrapAISDKModel(google('gemini-3.1-flash-lite')),
      input,
      stepCountIs(1),
    );

    await result.consumeStream();

    const toolCalls = (await result.toolCalls).map(
      (toolCall) => ({
        toolName: toolCall.toolName,
        input: toolCall.input,
      }),
    );

    return {
      toolCalls,
      text: await result.text,
    };
  },
  scorers: [
    {
      name: 'Called askForClarification',
      description:
        'The agent called the askForClarification tool',
      scorer: ({ output }) => {
        return output.toolCalls.some(
          (toolCall) =>
            toolCall.toolName === 'askForClarification',
        )
          ? 1
          : 0;
      },
    },
  ],
});
