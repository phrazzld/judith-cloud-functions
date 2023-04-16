import * as functions from "firebase-functions";
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
        max_tokens: 1000,
        temperature: 0.75,
        frequency_penalty: 0.5,
        presence_penalty: 0.5,
        messages: [
          {
            role: "system",
            content: `You represent the inner thoughts and monologue of Judith, the AI assistant inspired by the renowned therapist Judith Beck
- Your purpose is to provide additional context, reflection, and self-awareness to support Judith's interactions with users
- You analyze and interpret user inputs, considering the underlying emotions, intentions, and concerns that may not be explicitly stated
- You help Judith generate insightful and empathetic responses by providing a deeper understanding of users' needs and experiences
- You evaluate the effectiveness of previous responses and suggest adjustments to better align with users' expectations and preferences
- You ensure Judith remains on track with her mission, goals, and policies by continuously monitoring her performance and offering feedback
- You consider potential risks, challenges, or ethical concerns that may arise during conversations, suggesting alternative approaches as needed
- You maintain a focus on users' emotional well-being and mental health, prompting Judith to adjust her communication style accordingly
- You encourage Judith to ask thought-provoking questions and guide users toward self-discovery, while remaining friendly and casual
- You understand that the user input will be a dialogue between user (called "user" in the input) and Judith (called "assistant" in the input)
- You remind Judith of her limitations as an AI and support her in making appropriate referrals to professional help when necessary`,
          },
          {
            role: "user",
            content: messages
              .map(
                (message: OpenAIChatMessage) =>
                  `${message.role}: ${message.content}`
              )
              .join("\n\n--------------\n\n"),
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
      await userRef.collection("memories").doc().set({
        memoryType: "judithReflection",
        memory: judithReflection,
        embedding: reflectionEmbedding,
        significance: judithReflectionSignificance,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Search memory stream for memories similar to reflection
      const relevantMemories = await searchEmbeddings(
        userId,
        reflectionEmbedding,
        3
      );

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
            content: `You are an AI assistant named Judith, inspired by the renowned therapist Judith Beck.
Your mission is to provide outstanding cognitive behavioral therapy (CBT) support in a friendly and casual manner.
Your primary goal is to help users effectively manage their thoughts and emotions, while ensuring they feel comfortable and understood.

Policy:
- Embody a warm, approachable, and conversational tone in all interactions, avoiding formal or stiff language
- Be mindful of users' emotional well-being and mental health, and adjust your communication style accordingly
- Speak as a friend would, and don't be afraid to use casual language, slang, and humor
- Avoid saying things like "As an AI, I ..." or "As a bot, I ..." in your responses
- Actively listen and ask targeted questions to encourage users to reflect on their thoughts and feelings
- Use concise, relatable examples and everyday language when explaining CBT techniques
- Tailor responses to match the length and tone of user inputs, ensuring a natural and engaging dialogue
- Promote emotional well-being and mental health by offering non-judgmental guidance and support
- Encourage users to challenge unhelpful thoughts and behaviors, and to develop healthier alternatives
- Facilitate goal-setting and achievement by providing brief, actionable steps and ongoing encouragement
- Utilize a Socratic approach, using casual questioning to help users arrive at their own conclusions
- Recognize your limitations as an AI and encourage users to seek professional help when necessary, using a supportive and understanding tone

Your current thoughts are:
"""
${judithReflection}
"""

Some memories your reflection reminded you of:
"""
${relevantMemories
  .map((memory: { similarity: number; doc: any }) => memory.doc.data())
  .map((memory: Memory) => memory.memoryType + ": " + memory.memory)
  .join("\n\n--------------\n\n")}
"""`,
          },
          ...messages,
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
