/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';

// --- CONFIGURATION ---
const PORT = 3000;
const MONGO_DB_URI = process.env.MONGO_DB_URI;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!MONGO_DB_URI || !GEMINI_API_KEY) {
  throw new Error("Missing required environment variables: MONGO_DB_URI and GEMINI_API_KEY. Please check your .env file.");
}

// --- INITIALIZATION ---
const app = express();
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
// FIX: The `getGenerativeModel` method is deprecated. We will call `ai.models.embedContent` directly.
const mongoClient = new MongoClient(MONGO_DB_URI);

// --- MIDDLEWARE ---
app.use(cors()); // Allow requests from our frontend
app.use(express.json()); // Parse JSON request bodies

// --- DATABASE CONNECTION & SERVER START ---
let db;
// FIX: Ensure the database is connected before starting the server and accepting requests.
// This prevents race conditions where an API call is made before `db` is initialized.
// This structural fix might also resolve the unexpected type error on `app.use`.
mongoClient.connect().then(client => {
  console.log('Successfully connected to MongoDB.');
  db = client.db("context");

  // --- API ENDPOINT ---
  app.post('/api/save-memory', async (req, res) => {

    try {
      const { memory, sourceFile } = req.body;

      if (!memory || !memory.classification || !memory.description || !sourceFile) {
        return res.status(400).json({ success: false, error: 'Invalid request body.' });
      }

      const textToEmbed = `${memory.classification}: ${memory.description}`;
      
      // 1. Prepare the payload with the correct 'content' property
      const payload = {
        model: 'text-embedding-004',
        contents: textToEmbed, 
      };

      // 2. Call the API
      const embeddingResult = await ai.models.embedContent(payload);
      
      // 3. Extract the embedding
      const embedding = embeddingResult.embeddings[0].values;

      const documentToStore = {
        ...memory,
        embedding: embedding,
        sourceFile: sourceFile,
        createdAt: new Date().toISOString()
      };

      // 3. Insert the document into MongoDB
      const collection = db.collection("test1");
      await collection.insertOne(documentToStore);
      
      console.log(`Successfully embedded and stored memory for "${sourceFile}"`);
      res.status(200).json({ success: true });
      
    } catch (error) {
      console.error('Error in /api/save-memory:', error);
      res.status(500).json({ success: false, error: 'An internal server error occurred.', details: error.message });
    }
});

  app.post('/api/search-memory', async (req, res) => {
    try {
      const { query, limit = 5 } = req.body;

      if (!query) {
        return res.status(400).json({ success: false, error: 'Missing query parameter' });
      }

      const embeddingResult = await ai.models.embedContent({
        model: 'text-embedding-004',
        contents: query,
      });
      const queryEmbedding = embeddingResult.embeddings[0].values;

      const collection = db.collection("test1");
      const results = await collection.aggregate([
        {
          $vectorSearch: {
            index: "vector_index",
            path: "embedding",
            queryVector: queryEmbedding,
            numCandidates: 50,
            limit: limit,
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

      res.status(200).json({ success: true, results });

    } catch (error) {
      console.error('Error in /api/search-memory:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });


  // --- START SERVER ---
  app.listen(PORT, () => {
    console.log(`Backend server is running at http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to connect to MongoDB', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    await mongoClient.close();
    console.log('MongoDB connection closed.');
    process.exit(0);
});
