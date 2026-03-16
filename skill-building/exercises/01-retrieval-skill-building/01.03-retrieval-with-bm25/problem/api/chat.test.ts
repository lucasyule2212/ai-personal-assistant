import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { logTestStep } from '#shared/log-test-step.ts';
import {
  generateKeywordsFromMessages,
  getTopSearchResults,
} from './chat.ts';

const loadEnvFile = (filename: string) => {
  const envPath = path.resolve(
    import.meta.dirname,
    '../../../../..',
    filename,
  );

  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, 'utf8');

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
};

loadEnvFile('.env');
loadEnvFile('.env.local');

const hasGoogleApiKey = Boolean(
  process.env.GOOGLE_GENERATIVE_AI_API_KEY,
);

const itLive = hasGoogleApiKey ? it : it.skip;

const messages = [
  {
    id: 'msg-1',
    role: 'user',
    parts: [
      {
        type: 'text',
        text: 'What documents do I still need for the mortgage application on the Chorlton house purchase?',
      },
    ],
  },
] as UIMessage[];

describe('BM25 retrieval integration', () => {
  itLive(
    'generates keywords with a real AI call',
    { timeout: 30000 },
    async () => {
      logTestStep(
        'GIVEN',
        'generateKeywordsFromMessages receives this user query',
        messages,
      );
      const keywords = await generateKeywordsFromMessages(
        messages,
      );
      logTestStep(
        'WHEN',
        'the model generates these BM25 keywords',
        keywords,
      );
      logTestStep(
        'THEN',
        'the keywords should contain the core retrieval intent',
        keywords,
      );

      expect(keywords.length).toBeGreaterThan(0);
      expect(keywords.every((keyword) => keyword.length > 0)).toBe(
        true,
      );
      expect(
        keywords.some((keyword) =>
          /mortgage|documents|chorlton|house|purchase/i.test(
            keyword,
          ),
        ),
      ).toBe(true);
    },
  );

  itLive(
    'retrieves relevant emails from the real keyword output',
    { timeout: 30000 },
    async () => {
      logTestStep(
        'GIVEN',
        'getTopSearchResults starts from this conversation',
        messages,
      );
      const keywords = await generateKeywordsFromMessages(
        messages,
      );
      logTestStep(
        'WHEN',
        'the model generates these search keywords',
        keywords,
      );
      const results = await getTopSearchResults(keywords, {
        limit: 5,
      });
      logTestStep(
        'WHEN',
        'BM25 returns these ranked email subjects and scores',
        results.map((result) => ({
          subject: result.email?.subject ?? '',
          score: result.score,
        })),
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results.every((result) => result.score > 0)).toBe(
        true,
      );

      const subjects = results.map(
        (result) => result?.email?.subject ?? '',
      );
      logTestStep(
        'THEN',
        'the top results should include mortgage or purchase-related emails',
        subjects,
      );

      expect(
        subjects.some((subject) =>
          /mortgage|chorlton|house|property|conveyancing|solicitor|offer|purchase/i.test(
            subject,
          ),
        ),
      ).toBe(true);
    },
  );
});
