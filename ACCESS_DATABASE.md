# Accessing the MongoDB Vector Search Backend

## Prerequisites

- MongoDB Atlas connection string
- Gemini API key
- Node.js installed

## Environment Variables

Set the following environment variables:

```bash
export MONGO_DB_URI="your_mongodb_connection_string"
export GEMINI_API_KEY="your_gemini_api_key"
```

## Running the MCP Server

The MCP server is located at `mongodb_backend/mcp-server.mjs` and provides a `search_memories` tool.

```bash
cd mongodb_backend
node mcp-server.mjs
```

## Interview App Integration

The interview app now automatically queries the MongoDB vector database when it detects a question.

### Setup

1. Make sure you have the environment variables set:
   ```bash
   export MONGO_DB_URI="your_mongodb_connection_string"
   export GEMINI_API_KEY="your_gemini_api_key"
   ```

2. Start the backend server (runs on port 3001):
   ```bash
   cd mongodb_backend
   node server.mjs
   ```

3. In a separate terminal, run the interview app (runs on port 3000):
   ```bash
   cd interview_app
   npm run dev
   ```

### How It Works

1. The app uses live transcription to capture audio input
2. When it detects a question (using keyword or LLM-based detection)
3. It automatically queries the MongoDB vector database using the question text
4. Relevant memories are displayed below the transcription with:
   - Classification type
   - Description
   - Source file
   - Similarity score
   - Creation date

The vector search uses the same Gemini `text-embedding-004` model to create embeddings and performs similarity search against stored memories.

## Vector Search Details

**Database:** `context`
**Collection:** `test1`
**Vector Index:** `vector_index`
**Embedding Model:** `text-embedding-004` (Google Gemini)

## Search Tool

The server exposes a `search_memories` tool that:
- Takes a text query as input
- Converts the query to embeddings using Gemini's text-embedding-004 model
- Performs vector similarity search against stored memories
- Returns top 5 most relevant results with:
  - `classification`
  - `description`
  - `sourceFile`
  - `createdAt`
  - `score` (similarity score)

## Direct MongoDB Connection

To connect directly to the database:

```javascript
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_DB_URI);
await client.connect();
const db = client.db("context");
const collection = db.collection("test1");

// Run vector search
const results = await collection.aggregate([
  {
    $vectorSearch: {
      index: "vector_index",
      path: "embedding",
      queryVector: yourEmbeddingArray,
      numCandidates: 50,
      limit: 5,
    }
  },
  {
    $project: {
      _id: 0,
      classification: 1,
      description: 1,
      sourceFile: 1,
      createdAt: 1,
      score: { $meta: "vectorSearchScore" }
    }
  }
]).toArray();
```
