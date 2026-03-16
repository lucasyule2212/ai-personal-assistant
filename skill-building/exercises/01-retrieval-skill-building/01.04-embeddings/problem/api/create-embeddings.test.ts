import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logTestStep } from '#shared/log-test-step.ts';
import type { Email } from './create-embeddings.ts';

const embedManyMock = vi.fn();
const embedMock = vi.fn();
const cosineSimilarityMock = vi.fn();
const modelToken = { id: 'embedding-model' };

vi.mock('ai', () => ({
  embedMany: embedManyMock,
  embed: embedMock,
  cosineSimilarity: cosineSimilarityMock,
}));

vi.mock('@ai-sdk/google', () => ({
  google: {
    textEmbeddingModel: vi.fn(() => modelToken),
  },
}));

const {
  embedLotsOfText,
  embedOnePieceOfText,
  calculateScore,
} = await import('./create-embeddings.ts');

const solarEclipseEmail: Email = {
  id: 'email-1',
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 'Solar eclipse',
  body: 'The sun was blocked by the moon.',
  timestamp: '2025-01-01T00:00:00.000Z',
};

const houseHuntingEmail: Email = {
  id: 'email-2',
  from: 'c@example.com',
  to: 'd@example.com',
  subject: 'House hunting',
  body: 'Sarah wants three bedrooms and a garden.',
  timestamp: '2025-01-02T00:00:00.000Z',
};

describe('embedding helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('embedLotsOfText', () => {
    it('sends one combined string per email and preserves each email id in the response', async () => {
      const emails: Email[] = [
        solarEclipseEmail,
        houseHuntingEmail,
      ];

      embedManyMock.mockResolvedValue({
        embeddings: [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
      });
      logTestStep(
        'GIVEN',
        'embedLotsOfText receives these emails',
        emails.map((email) => ({
          id: email.id,
          subject: email.subject,
          body: email.body,
        })),
      );
      logTestStep(
        'GIVEN',
        'the embedding SDK returns one vector per email',
        [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
      );

      const result = await embedLotsOfText(emails);
      logTestStep(
        'WHEN',
        'embedLotsOfText calls the SDK with this payload',
        embedManyMock.mock.calls[0]?.[0],
      );
      logTestStep(
        'THEN',
        'embedLotsOfText maps the SDK response back to ids',
        result,
      );

      expect(embedManyMock).toHaveBeenCalledWith({
        model: modelToken,
        values: [
          'Solar eclipse The sun was blocked by the moon.',
          'House hunting Sarah wants three bedrooms and a garden.',
        ],
        maxRetries: 0,
      });

      expect(result).toEqual([
        {
          id: 'email-1',
          embedding: [0.1, 0.2],
        },
        {
          id: 'email-2',
          embedding: [0.3, 0.4],
        },
      ]);
    });
  });

  describe('embedOnePieceOfText', () => {
    it('passes the raw query text to the SDK and returns only the embedding vector', async () => {
      embedMock.mockResolvedValue({
        embedding: [0.9, 0.8, 0.7],
      });
      logTestStep(
        'GIVEN',
        'embedOnePieceOfText receives this search query',
        'looking for a new place to live',
      );
      logTestStep(
        'GIVEN',
        'the embedding SDK returns this vector',
        [0.9, 0.8, 0.7],
      );

      const result = await embedOnePieceOfText(
        'looking for a new place to live',
      );
      logTestStep(
        'WHEN',
        'embedOnePieceOfText calls the SDK with this payload',
        embedMock.mock.calls[0]?.[0],
      );
      logTestStep(
        'THEN',
        'embedOnePieceOfText returns only the embedding array',
        result,
      );

      expect(embedMock).toHaveBeenCalledWith({
        model: modelToken,
        value: 'looking for a new place to live',
      });

      expect(result).toEqual([0.9, 0.8, 0.7]);
    });
  });

  describe('calculateScore', () => {
    it('delegates scoring to cosine similarity with query first and document second', () => {
      cosineSimilarityMock.mockReturnValue(0.42);
      logTestStep(
        'GIVEN',
        'calculateScore receives this query embedding',
        [1, 0, 0],
      );
      logTestStep(
        'GIVEN',
        'calculateScore receives this document embedding',
        [0.9, 0.1, 0],
      );
      logTestStep(
        'GIVEN',
        'cosine similarity will return this score',
        0.42,
      );

      const result = calculateScore(
        [1, 0, 0],
        [0.9, 0.1, 0],
      );
      logTestStep(
        'WHEN',
        'calculateScore calls cosineSimilarity with',
        cosineSimilarityMock.mock.calls[0],
      );
      logTestStep(
        'THEN',
        'calculateScore returns this final score',
        result,
      );

      expect(cosineSimilarityMock).toHaveBeenCalledWith(
        [1, 0, 0],
        [0.9, 0.1, 0],
      );
      expect(result).toBe(0.42);
    });
  });
});
