import { describe, expect, it, vi } from 'vitest';
import { createUIMessageFixture } from '#shared/create-ui-message-fixture.ts';
import { logTestStep } from '#shared/log-test-step.ts';
import {
  formatMessageHistory,
  getTopSearchResults,
} from './chat.ts';

const buildSearchResult = (index: number) => ({
  score: 10 - index,
  email: {
    id: `email-${index + 1}`,
    from: 'agent@example.com',
    to: 'user@example.com',
    subject: `Email ${index + 1}`,
    body: `Body ${index + 1}`,
    timestamp: '2025-01-01T00:00:00.000Z',
  },
});

describe('embedding retrieval chat helpers', () => {
  describe('formatMessageHistory', () => {
    it('turns alternating UI messages into the exact string sent to semantic search', () => {
      const messages = createUIMessageFixture(
        'What was Sarah looking for in a house?',
        'She wanted a garden and a bigger kitchen.',
      );
      logTestStep(
        'GIVEN',
        'formatMessageHistory receives these UI messages',
        messages,
      );

      const result = formatMessageHistory(messages);
      logTestStep(
        'WHEN',
        'formatMessageHistory converts them into one search string',
        result,
      );
      logTestStep(
        'THEN',
        'semantic search will embed this exact conversation history',
        result,
      );

      expect(result).toBe(
        [
          'user: What was Sarah looking for in a house?',
          'assistant: She wanted a garden and a bigger kitchen.',
        ].join('\n'),
      );
    });
  });

  describe('getTopSearchResults', () => {
    it('searches with the formatted conversation and returns only the highest-ranked five emails', async () => {
      const messages = createUIMessageFixture(
        'What was Sarah looking for in a house?',
        'She mentioned wanting more space.',
        'Did she care about a garden?',
      );

      // This dependency is injected on purpose.
      // We are not testing semantic search itself here.
      // We are testing that chat.ts builds the right query string
      // and trims the ranked results correctly.
      const searchEmailsFn = vi.fn().mockResolvedValue(
        Array.from({ length: 7 }, (_, index) =>
          buildSearchResult(index),
        ),
      );
      logTestStep(
        'GIVEN',
        'getTopSearchResults receives these UI messages',
        messages,
      );

      const results = await getTopSearchResults(messages, {
        searchEmailsFn,
      });
      const fullRankedResults = await searchEmailsFn.mock.results[0]
        ?.value;
      logTestStep(
        'WHEN',
        'getTopSearchResults sends this formatted query to searchEmails',
        searchEmailsFn.mock.calls[0]?.[0],
      );
      logTestStep(
        'WHEN',
        'searchEmails returns this ranked list',
        fullRankedResults,
      );
      logTestStep(
        'THEN',
        'getTopSearchResults keeps these top five results',
        results.map((result) => ({
          subject: result.email.subject,
          score: result.score,
        })),
      );

      expect(searchEmailsFn).toHaveBeenCalledWith(
        [
          'user: What was Sarah looking for in a house?',
          'assistant: She mentioned wanting more space.',
          'user: Did she care about a garden?',
        ].join('\n'),
      );

      // Only the top five should be passed downstream to prompt assembly.
      expect(results).toHaveLength(5);
      expect(
        results.map((result) => result.email.subject),
      ).toEqual([
        'Email 1',
        'Email 2',
        'Email 3',
        'Email 4',
        'Email 5',
      ]);
    });
  });
});
