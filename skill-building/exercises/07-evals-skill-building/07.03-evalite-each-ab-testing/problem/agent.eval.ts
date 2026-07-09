import { stepCountIs, type UIMessage } from 'ai';
import { evalite } from 'evalite';
import { runAgent } from './agent.ts';
import { google } from '@ai-sdk/google';
import { createUIMessageFixture } from '#shared/create-ui-message-fixture.ts';
import { wrapAISDKModel } from 'evalite/ai-sdk';

evalite.each([
  {
    name: 'Gemini 3.1 Flash Lite',
    input: google('gemini-3.1-flash-lite'),
  },
  {
    name: 'Gemini 3 Flash Preview',
    input: google('gemini-3-flash-preview'),
  },
  {
    name: 'Gemini 3.5 Flash',
    input: google('gemini-3.5-flash'),
  },
  {
    name: 'Gemini 3.1 Pro Preview',
    input: google('gemini-3.1-pro-preview'),
  },
])('Agent Tool Call Evaluation', {
  data: [
    {
      input: createUIMessageFixture(
        'What is the weather in San Francisco right now?',
      ),
      expected: { tool: 'checkWeather' },
    },
    {
      input: createUIMessageFixture(
        'Create a spreadsheet called "Q4 Sales" with columns for Date, Product, and Revenue',
      ),
      expected: { tool: 'createSpreadsheet' },
    },
    {
      input: createUIMessageFixture(
        'Send an email to john@example.com with subject "Meeting Tomorrow" and body "Don\'t forget our 2pm meeting"',
      ),
      expected: { tool: 'sendEmail' },
    },
    {
      input: createUIMessageFixture(
        'Translate "Hello world" to Spanish',
      ),
      expected: { tool: 'translateText' },
    },
    {
      input: createUIMessageFixture(
        'Set a reminder for tomorrow at 9am to call the dentist',
      ),
      expected: { tool: 'setReminder' },
    },
  ],
  task: async (messages, model) => {
    const result = runAgent(
      wrapAISDKModel(model),
      messages,
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
      name: 'Matches Expected Tool',
      description: 'The agent called the expected tool',
      scorer: ({ output, expected }) => {
        return output.toolCalls.some(
          (toolCall) => toolCall.toolName === expected?.tool,
        )
          ? 1
          : 0;
      },
    },
  ],
});
