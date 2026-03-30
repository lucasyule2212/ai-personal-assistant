import {
  accessSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

export namespace DB {
  // Types for our persistence layer
  export interface MemoryItem {
    id: string;
    title: string;
    content: string;
    createdAt: string;
    updatedAt: string;
  }

  export interface PersistenceData {
    memories: DB.MemoryItem[];
  }
}

// File path for storing the data
const DATA_FILE_PATH = join(
  process.cwd(),
  'data',
  'memories.local.json',
);

/**
 * Ensure the data directory exists
 */
function ensureDataDirectory(): void {
  const dataDir = join(process.cwd(), 'data');
  try {
    accessSync(dataDir);
  } catch {
    mkdirSync(dataDir, { recursive: true });
  }
}

function loadDB(): DB.PersistenceData {
  try {
    ensureDataDirectory();
    const data = readFileSync(DATA_FILE_PATH, 'utf-8');
    return JSON.parse(data) as DB.PersistenceData;
  } catch (error) {
    return { memories: [] };
  }
}

/**
 * Load all chats from the JSON file
 */
export function loadMemories(): DB.MemoryItem[] {
  try {
    ensureDataDirectory();
    const data = readFileSync(DATA_FILE_PATH, 'utf-8');
    const parsed: DB.PersistenceData = JSON.parse(data);
    return (parsed.memories || []).sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() -
        new Date(a.updatedAt).getTime(),
    );
  } catch (error) {
    // If file doesn't exist or is invalid, return empty array
    return [];
  }
}

/**
 * Save all memories to the JSON file
 */
export function saveMemories(memories: DB.MemoryItem[]): void {
  writeFileSync(
    DATA_FILE_PATH,
    JSON.stringify({ memories }, null, 2),
    'utf-8',
  );
}

export function updateMemory(
  memoryId: string,
  memory: Pick<DB.MemoryItem, 'title' | 'content'>,
): boolean {
  const data = loadDB();
  const memoryIndex = data.memories.findIndex(
    (m) => m.id === memoryId,
  );

  if (memoryIndex === -1) {
    return false;
  }

  data.memories = data.memories.map((m) =>
    m.id === memoryId
      ? {
          ...m,
          ...memory,
          updatedAt: new Date().toISOString(),
        }
      : m,
  );

  writeFileSync(
    DATA_FILE_PATH,
    JSON.stringify(data, null, 2),
    'utf-8',
  );

  return true;
}

export function deleteMemory(memoryId: string): boolean {
  const data = loadDB();
  const initialLength = data.memories.length;
  data.memories = data.memories.filter((m) => m.id !== memoryId);

  if (data.memories.length === initialLength) {
    return false;
  }

  writeFileSync(
    DATA_FILE_PATH,
    JSON.stringify(data, null, 2),
    'utf-8',
  );

  return true;
}
