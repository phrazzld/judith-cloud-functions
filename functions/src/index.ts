import * as FirebaseAdmin from "firebase-admin";
import * as functions from "firebase-functions";
import { ERROR_MESSAGES } from "./constants";
import { getEmbedding, searchEmbeddings } from "./embeddings";
import { admin } from "./firebase";
import { createMemoryDocument, createMessageDocument } from "./firestore";
import { openaiClient } from "./openai";
import { PROMPTS } from "./prompts";
import { Memory, Message } from "./types";
import {
  embedAndStoreMemory,
  getJudithReflection,
  getMemorySignificance,
  recordAndUploadAudio,
} from "./utils";
import { validateMessages } from "./validation";

// TODO: Define daily cronjob that schedules personal push notification messages
// TODO: Add moderation check

// TODO: Handle receiving a new message while the previous message is still being processed
export const getResponseToMessage = functions
  .runWith({ timeoutSeconds: 540 })
  .https.onRequest(
    async (request: functions.Request, response: functions.Response) => {
      try {
        const { userId, messages, useAudio } = request.body;
        await admin.auth().getUser(userId);

        validateMessages(messages);

        // TODO: Clear scheduled push notifications for user

        // Get significance of last message
        // TODO: Make memory significance classification more robust so we get fewer nulls
        const memory = messages[messages.length - 1].content;
        const memorySignificance = await getMemorySignificance(memory);

        // Embed memory, store in memory stream
        await embedAndStoreMemory(
          userId,
          "userMessage",
          memory,
          memorySignificance
        );

        // Reflect on current message context
        const judithReflection = await getJudithReflection(userId, messages);
        // Embed reflection, store in memory stream
        const judithReflectionSignificance = await getMemorySignificance(
          judithReflection
        );
        const reflectionEmbedding = await getEmbedding(judithReflection);

        // Search memory stream for memories similar to reflection
        const relevantMemories = await searchEmbeddings(
          userId,
          reflectionEmbedding,
          3
        );

        const reflectionMemoryData: Memory = {
          memoryType: "judithReflection",
          memory: judithReflection,
          embedding: reflectionEmbedding,
          significance: judithReflectionSignificance,
          // Map relevantMemories to include similarity, the doc's memoryType, and the doc's memory
          triggeredMemories: relevantMemories
            .map(
              (memory: { weightedScore: number; doc: any }) =>
                `(${memory.weightedScore}) :: ${memory.doc
                  .data()
                  .createdAt.toDate()} :: ${memory.doc.data().memoryType}:\n${
                  memory.doc.data().memory
                }`
            )
            .join("\n\n###\n\n"),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          lastAccessedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        await createMemoryDocument(userId, reflectionMemoryData);

        const formattedMemories = `${relevantMemories
          .map((memory: { weightedScore: number; doc: any }) =>
            memory.doc.data()
          )
          .map(
            (memory: Memory) =>
              `${(
                memory.createdAt as FirebaseAdmin.firestore.Timestamp
              ).toDate()} :: ${memory.memoryType}:\n${memory.memory}`
          )
          .join("\n\n###\n\n")}`;

        // Add memories to response context
        const openaiResponse = await openaiClient.createChatCompletion({
          model: "gpt-4",
          max_tokens: 200,
          temperature: 0.75,
          frequency_penalty: 0.5,
          presence_penalty: 0.5,
          user: userId,
          messages: [
            {
              role: "system",
              content: PROMPTS.JUDITH_PERSONA_SYSTEM_INIT,
            },
            ...messages,
            {
              role: "assistant",
              content: PROMPTS.JUDITH_PERSONA_CHAT.replace(
                "{REFLECTION}",
                judithReflection
              ).replace("{MEMORIES}", formattedMemories),
            },
          ],
        });

        if (openaiResponse.status !== 200) {
          console.error(openaiResponse.data);
          functions.logger.error(openaiResponse.data);
          throw new Error(ERROR_MESSAGES.OPENAI_ERROR);
        }

        const chatResponse =
          openaiResponse.data.choices[0].message?.content.trim() || "";

        // Embed Judith's response in the memory stream
        const judithResponseSignificance = await getMemorySignificance(
          chatResponse
        );
        const judithMessageEmbedding = await getEmbedding(chatResponse);
        const judithMessageMemoryData: Memory = {
          memoryType: "judithMessage",
          memory: chatResponse,
          embedding: judithMessageEmbedding,
          significance: judithResponseSignificance,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          lastAccessedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        await createMemoryDocument(userId, judithMessageMemoryData);

        const judithMessageData: Message = {
          sender: "bot",
          text: chatResponse,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        await createMessageDocument(userId, judithMessageData);

        let filename = null;
        if (useAudio) {
          filename = await recordAndUploadAudio(userId, chatResponse);
        }

        response.status(200).send({ audioUrl: filename });
      } catch (err: any) {
        console.error(err);
        functions.logger.error(err);
        response.status(500).send({
          error: ERROR_MESSAGES.GENERIC,
        });
      }
    }
  );
