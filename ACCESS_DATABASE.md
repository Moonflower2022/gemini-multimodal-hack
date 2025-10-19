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
