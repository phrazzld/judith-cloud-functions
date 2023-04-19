import axios from "axios";
import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { ELEVEN_LABS_BASE_URL, ERROR_MESSAGES, VOICE_ID } from "./constants";
import { getEmbedding } from "./embeddings";
import { createMemoryDocument } from "./firestore";
import { openaiClient } from "./openai";
import { PROMPTS } from "./prompts";
import { Memory, MemoryType, OpenAIChatMessage } from "./types";
import { validateMemory, validateMemorySignificance } from "./validation";

export const getMemorySignificance = async (
  memoryContent: string
): Promise<number | null> => {
  try {
    validateMemory(memoryContent);

    const openaiResponse = await openaiClient.createChatCompletion({
      model: "gpt-3.5-turbo",
      max_tokens: 5,
      temperature: 0.0,
      messages: [
        {
          role: "system",
          content: PROMPTS.MEMORY_SIGNIFICANCE_SYSTEM_INIT,
        },
        {
          role: "user",
          content: memoryContent,
        },
      ],
    });

    if (openaiResponse.status !== 200) {
      console.error(openaiResponse);
      functions.logger.error(openaiResponse);
      throw new Error(ERROR_MESSAGES.OPENAI_ERROR);
    }

    // Validate that the response is a number between 1 and 10
    const memorySignificance = Number(
      openaiResponse.data.choices[0].message?.content.trim()
    );

    validateMemorySignificance(memorySignificance);

    return memorySignificance;
  } catch (err: any) {
    console.error(err);
    functions.logger.error(err);
    throw new Error("Error getting memory significance.");
  }
};

export const embedAndStoreMemory = async (
  userId: string,
  memoryType: MemoryType,
  memoryContent: string,
  significance: number | null
) => {
  try {
    const embedding = await getEmbedding(memoryContent);

    const memoryData: Memory = {
      memoryType,
      memory: memoryContent,
      embedding,
      significance,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastAccessedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await createMemoryDocument(userId, memoryData);
  } catch (err: any) {
    console.error(err);
    functions.logger.error(err);
    throw new Error("Error embedding and storing memory");
  }
};

export const getJudithReflection = async (
  userId: string,
  messages: any[]
): Promise<string> => {
  try {
    const judithReflectionResponse = await openaiClient.createChatCompletion({
      model: "gpt-4",
      max_tokens: 500,
      temperature: 0.75,
      frequency_penalty: 0.5,
      presence_penalty: 0.5,
      user: userId,
      messages: [
        {
          role: "system",
          content: PROMPTS.JUDITH_INNER_THOUGHTS_SYSTEM_INIT,
        },
        {
          role: "user",
          content: messages
            .map(
              (message: OpenAIChatMessage) =>
                `${message.role === "assistant" ? "Judith" : "User"}: ${
                  message.content
                }`
            )
            .join("\n\n###\n\n"),
        },
      ],
    });

    if (judithReflectionResponse.status !== 200) {
      throw new Error("Error getting Judith reflection");
    }

    const judithReflection =
      judithReflectionResponse.data.choices[0].message?.content.trim() || "";

    return judithReflection;
  } catch (err: any) {
    console.error(err);
    functions.logger.error(err);
    throw new Error("Error getting and storing Judith reflection");
  }
};

export const recordAndUploadAudio = async (
  userId: string,
  text: string
): Promise<string> => {
  try {
    const elevenLabsResponse = await axios.post(
      `${ELEVEN_LABS_BASE_URL}/${VOICE_ID}`,
      { text },
      {
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": process.env.ELEVEN_LABS_API_KEY,
        },
        responseType: "arraybuffer",
      }
    );

    const buffer = elevenLabsResponse.data;

    // Save the audio file to Firebase Storage under a bucket for the user
    const bucket = admin.storage().bucket();
    const filename = `${userId}/${Date.now()}.mp3`;
    const file = bucket.file(filename);
    await file.save(buffer, {
      metadata: {
        contentType: "audio/mpeg",
      },
    });
    return filename;
  } catch (err: any) {
    console.error(err);
    functions.logger.error(err);
    throw new Error("Error recording and uploading audio");
  }
};
