#!/usr/bin/env node

import fetch, { Headers } from 'node-fetch';
globalThis.fetch = fetch;
globalThis.Headers = Headers;

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';

const MONGO_DB_URI = process.env.MONGO_DB_URI;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!MONGO_DB_URI || !GEMINI_API_KEY) {
  throw new Error("Missing required environment variables");
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const mongoClient = new MongoClient(MONGO_DB_URI);

const server = new Server(
  {
    name: "memory-vector-search",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_memories",
        description: "Search stored memories using vector similarity. Returns the top 5 most relevant memories based on semantic similarity.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query to find relevant memories",
            },
          },
          required: ["query"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "search_memories") {
    const query = request.params.arguments.query;

    try {
      await mongoClient.connect();
      const db = mongoClient.db("context");
      const collection = db.collection("test1");

      const embeddingResult = await ai.models.embedContent({
        model: 'text-embedding-004',
        contents: query,
      });
      const queryEmbedding = embeddingResult.embeddings[0].values;

      const results = await collection.aggregate([
        {
          $vectorSearch: {
            index: "vector_index",
            path: "embedding",
            queryVector: queryEmbedding,
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

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  throw new Error(`Unknown tool: ${request.params.name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
