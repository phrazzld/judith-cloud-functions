import * as functions from "firebase-functions";
import { PROMPTS } from "./prompts";
import { ERROR_MESSAGES, STATUS_CODES } from "./constants";
import { admin, firestore } from "./firebase";
import { openaiClient } from "./openai";
import { Memory, OpenAIChatMessage } from "./types";
import {
  getMemorySignificance,
  handleError,
  searchEmbeddings,
  validateMessages,
} from "./utils";

// TODO: Define daily cronjob that schedules personal push notification messages

// TODO: Handle receiving a new message while the previous message is still being processed
export const getResponseToMessage = functions
  .runWith({ timeoutSeconds: 540 })
  .https.onRequest(async (request, response) => {
    try {
      const { userId, messages } = request.body;
      await admin.auth().getUser(userId);

      const isValid = validateMessages(messages, response);
      if (!isValid) return;

      // TODO: Clear scheduled push notifications for user

      // TODO: Truncate total length of combined messages and system init to 2048 tokens
      // NOTE: This is currently handled on the client, but should be handled on the server as well

      // Get significance of last message
      const memory = messages[messages.length - 1].content;
      const memorySignificance = await getMemorySignificance(memory);

      // Embed memory, store in memory stream
      const userRef = firestore.collection("users").doc(userId);
      const embeddingResponse = await openaiClient.createEmbedding({
        model: "text-embedding-ada-002",
        input: memory,
      });
      const embedding = embeddingResponse.data.data[0].embedding;
      await userRef.collection("memories").doc().set({
        memoryType: "userMessage",
        memory,
        embedding,
        significance: memorySignificance,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Reflect on current message context
      const judithReflectionResponse = await openaiClient.createChatCompletion({
        model: "gpt-4",
        max_tokens: 500,
        temperature: 0.75,
        frequency_penalty: 0.5,
        presence_penalty: 0.5,
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
                  `${message.role}: ${message.content}`
              )
              .join("\n\n###\n\n"),
          },
        ],
      });

      if (judithReflectionResponse.status !== 200) {
        handleError({
          err: judithReflectionResponse,
          statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
          errorMessage: ERROR_MESSAGES.OPENAI_ERROR,
          response,
        });
        return;
      }

      const judithReflection =
        judithReflectionResponse.data.choices[0].message?.content.trim();

      // Embed reflection, store in memory stream
      if (!judithReflection) {
        handleError({
          err: judithReflectionResponse,
          statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
          errorMessage: ERROR_MESSAGES.OPENAI_ERROR,
          response,
        });
        return;
      }
      const judithReflectionSignificance = await getMemorySignificance(
        judithReflection
      );
      const reflectionEmbeddingResponse = await openaiClient.createEmbedding({
        model: "text-embedding-ada-002",
        input: judithReflection,
      });
      const reflectionEmbedding =
        reflectionEmbeddingResponse.data.data[0].embedding;

      // Search memory stream for memories similar to reflection
      const relevantMemories = await searchEmbeddings(
        userId,
        reflectionEmbedding,
        3
      );

      await userRef
        .collection("memories")
        .doc()
        .set({
          memoryType: "judithReflection",
          memory: judithReflection,
          embedding: reflectionEmbedding,
          significance: judithReflectionSignificance,
          // Map relevantMemories to include similarity, the doc's memoryType, and the doc's memory
          triggeredMemories: relevantMemories
            .map(
              (memory: { similarity: number; doc: any }) =>
                `(${memory.similarity}) :: ${memory.doc.data().createdAt.toDate()} :: ${
                  memory.doc.data().memoryType
                }:\n${memory.doc.data().memory}`
            )
            .join("\n\n###\n\n"),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      // Add memories to response context
      const openaiResponse = await openaiClient.createChatCompletion({
        model: "gpt-4",
        max_tokens: 200,
        temperature: 0.75,
        frequency_penalty: 0.5,
        presence_penalty: 0.5,
        messages: [
          {
            role: "system",
            content: PROMPTS.JUDITH_PERSONA_SYSTEM_INIT,
          },
          ...messages,
          {
            role: "assistant",
            content: `${judithReflection}

This reminds me of these memories:
"""
${relevantMemories
  .map((memory: { similarity: number; doc: any }) => memory.doc.data())
  .map(
    (memory: Memory) =>
      `${memory.createdAt.toDate()} :: ${memory.memoryType}:\n${memory.memory}`
  )
  .join("\n\n###\n\n")}
"""`,
          },
        ],
      });

      if (openaiResponse.status !== 200) {
        handleError({
          err: openaiResponse,
          statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
          errorMessage: ERROR_MESSAGES.OPENAI_ERROR,
          response,
        });
        return;
      }

      const chatResponse =
        openaiResponse.data.choices[0].message?.content.trim();

      // Embed Judith's response in the memory stream
      const judithResponseSignificance = await getMemorySignificance(
        chatResponse || ""
      );
      const judithMessageEmbeddingResponse = await openaiClient.createEmbedding(
        {
          model: "text-embedding-ada-002",
          input: memory,
        }
      );
      const judithMessageEmbedding =
        judithMessageEmbeddingResponse.data.data[0].embedding;
      await userRef.collection("memories").doc().set({
        memoryType: "judithMessage",
        memory: chatResponse,
        embedding: judithMessageEmbedding,
        significance: judithResponseSignificance,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      response.status(200).send({
        response: chatResponse,
      });
    } catch (err: any) {
      handleError({
        err,
        statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
        errorMessage: ERROR_MESSAGES.GENERIC,
        response,
      });
    }
  });
