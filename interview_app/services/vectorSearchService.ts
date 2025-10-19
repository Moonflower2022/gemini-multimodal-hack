// Backend API configuration
const BACKEND_URL = 'http://localhost:5001';

export interface MemorySearchResult {
  classification: string;
  description: string;
  sourceFile: string;
  createdAt: string;
  score: number;
}

/**
 * Searches stored memories using vector similarity via backend API
 * @param query The search query to find relevant memories
 * @param limit Maximum number of results to return
 * @returns Most relevant memories with similarity scores
 */
export async function searchMemories(query: string, limit: number = 3): Promise<MemorySearchResult[]> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/search-memory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, limit }),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Search failed');
    }

    return data.results as MemorySearchResult[];
  } catch (error) {
    console.error('Error searching memories:', error);
    throw error;
  }
}
