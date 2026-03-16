import { describe, expect, it, vi } from 'vitest';
import { createUIMessageFixture } from '#shared/create-ui-message-fixture.ts';
import { logTestStep } from '#shared/log-test-step.ts';
import {
  QUERY_REWRITE_SCHEMA,
  generateSearchTermsFromMessages,
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

describe('query rewriting chat helpers', () => {
  describe('generateSearchTermsFromMessages', () => {
    it('returns exact-match keywords and a broader semantic search query', async () => {
      const messages = createUIMessageFixture(
        'What did David say about the mortgage application?',
      );

      const convertedMessages = [
        { role: 'user', content: 'converted' },
      ];
      const convertMessagesFn = vi
        .fn()
        .mockReturnValue(convertedMessages);
      const generateObjectFn = vi.fn().mockResolvedValue({
        object: {
          keywords: ['David', 'mortgage application'],
          searchQuery:
            'David discussing the status of a mortgage application',
        },
      });

      logTestStep(
        'GIVEN',
        'generateSearchTermsFromMessages receives this chat history',
        messages,
      );

      const result = await generateSearchTermsFromMessages(
        messages,
        {
          convertMessagesFn,
          generateObjectFn,
          model: 'test-model',
        },
      );

      logTestStep(
        'WHEN',
        'the query rewriter returns these search terms',
        result,
      );

      expect(result).toEqual({
        keywords: ['David', 'mortgage application'],
        searchQuery:
          'David discussing the status of a mortgage application',
      });

      expect(convertMessagesFn).toHaveBeenCalledWith(messages);
      expect(generateObjectFn).toHaveBeenCalledWith({
        model: 'test-model',
        system: expect.stringContaining(
          'You should also generate a search query',
        ),
        schema: QUERY_REWRITE_SCHEMA,
        messages: convertedMessages,
      });

      expect(() =>
        QUERY_REWRITE_SCHEMA.parse({
          keywords: ['mortgage'],
          searchQuery: 'mortgage application status',
        }),
      ).not.toThrow();

      expect(() =>
        QUERY_REWRITE_SCHEMA.parse({
          keywords: ['mortgage'],
        }),
      ).toThrow();
    });
  });

  describe('getTopSearchResults', () => {
    it('passes keywords to BM25 and searchQuery to embeddings before trimming to five results', async () => {
      const searchTerms = {
        keywords: ['Sarah', 'properties'],
        searchQuery: 'homes Sarah was interested in',
      };

      const searchEmailsFn = vi
        .fn()
        .mockResolvedValue(
          Array.from({ length: 7 }, (_, index) =>
            buildSearchResult(index),
          ),
        );

      logTestStep(
        'GIVEN',
        'getTopSearchResults receives these rewritten search terms',
        searchTerms,
      );

      const results = await getTopSearchResults(searchTerms, {
        searchEmailsFn,
      });

      logTestStep(
        'WHEN',
        'hybrid search is called with this payload',
        searchEmailsFn.mock.calls[0]?.[0],
      );
      logTestStep(
        'THEN',
        'only the highest-ranked five emails are kept',
        results.map((result) => ({
          subject: result.email.subject,
          score: result.score,
        })),
      );

      expect(searchEmailsFn).toHaveBeenCalledWith({
        keywordsForBM25: ['Sarah', 'properties'],
        embeddingsQuery: 'homes Sarah was interested in',
      });

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
