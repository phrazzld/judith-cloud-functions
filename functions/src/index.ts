import * as functions from "firebase-functions";
import { ERROR_MESSAGES, STATUS_CODES } from "./constants";
import { openaiClient } from "./openai";
import { Memory, OpenAIChatMessage } from "./types";
import { admin, firestore } from "./firebase";

interface HandleErrorParams {
  err: any;
  statusCode: number;
  errorMessage: string;
  response: any;
}

const handleError = (params: HandleErrorParams) => {
  const { err, statusCode, errorMessage, response } = params;
  // Validate presence of all params
  if (!err || !statusCode || !errorMessage) {
    throw new Error("handleError requires all params to be present");
  }

  console.error(err);
  functions.logger.error(err);

  if (response) {
    response.status(statusCode).send({ error: errorMessage });
  }
};

const validateMessages = (messages: any, response: any) => {
  if (!messages) {
    handleError({
      err: ERROR_MESSAGES.MESSAGES_REQUIRED,
      statusCode: STATUS_CODES.BAD_REQUEST,
      errorMessage: ERROR_MESSAGES.MESSAGES_REQUIRED,
      response,
    });
    return false;
  }

  // Validate that messages is an array of objects with a role and content
  if (!Array.isArray(messages)) {
    handleError({
      err: ERROR_MESSAGES.MESSAGES_ARRAY,
      statusCode: STATUS_CODES.BAD_REQUEST,
      errorMessage: ERROR_MESSAGES.MESSAGES_ARRAY,
      response,
    });
    return false;
  }

  for (const message of messages) {
    if (
      typeof message !== "object" ||
      !message.role ||
      !message.content ||
      typeof message.role !== "string" ||
      typeof message.content !== "string"
    ) {
      handleError({
        err: ERROR_MESSAGES.MESSAGES_OBJECTS,
        statusCode: STATUS_CODES.BAD_REQUEST,
        errorMessage: ERROR_MESSAGES.MESSAGES_OBJECTS,
        response,
      });
      return;
    }
  }

  return true;
};

const cosineSimilarity = (a: number[], b: number[]): number => {
  const dotProduct = a.reduce((sum, value, i) => sum + value * b[i], 0);
  const magnitudeA = Math.sqrt(
    a.reduce((sum, value) => sum + value * value, 0)
  );
  const magnitudeB = Math.sqrt(
    b.reduce((sum, value) => sum + value * value, 0)
  );
  return dotProduct / (magnitudeA * magnitudeB);
};

const searchEmbeddings = async (userId: string, embedding: number[], numResults: number) => {
  const userRef = firestore.collection("users").doc(userId);
  const memoryStream = await userRef.collection("memories").get();
  const similarities = memoryStream.docs.map((doc) => {
    const { embedding: memoryEmbedding } = doc.data();
    const similarity = cosineSimilarity(embedding, memoryEmbedding);
    return { similarity, doc };
  });
  similarities.sort((a, b) => b.similarity - a.similarity).slice(0, numResults);
  return similarities;
};

// TODO: Define daily cronjob that schedules personal push notification messages

// TODO: Handle receiving a new message while the previous message is still being processed
export const getResponseToMessage = functions
  .runWith({ timeoutSeconds: 540 })
  .https.onRequest(async (request, response) => {
    try {
      const { userId, messages } = request.body;
      functions.logger.info("Received request", { userId, messages });
      await admin.auth().getUser(userId);
      functions.logger.info("User is authenticated");

      const isValid = validateMessages(messages, response);
      if (!isValid) return;

      // TODO: Clear scheduled push notifications for user

      // TODO: Truncate total length of combined messages and system init to 2048 tokens
      // NOTE: This is currently handled on the client, but should be handled on the server as well

      // Get significance of last message
      functions.logger.info("Getting significance of last message");
      const memory = messages[messages.length - 1].content;
      const memorySignificance = await getMemorySignificance(memory);
      functions.logger.info("Memory significance", { memorySignificance });

      // Embed memory, store in memory stream
      functions.logger.info("Embedding memory");
      const userRef = firestore.collection("users").doc(userId);
      const embeddingResponse = await openaiClient.createEmbedding({
        model: "text-embedding-ada-002",
        input: memory,
      });
      const embedding = embeddingResponse.data.data[0].embedding;
      functions.logger.info("Memory embedding", { embedding });
      await userRef.collection("memories").doc().set({
        memoryType: "userMessage",
        memory,
        embedding,
        significance: memorySignificance,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      functions.logger.info("Memory stored in memory stream");

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
      functions.logger.info("Judith reflection response", {
        judithReflectionResponse,
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
      functions.logger.info("Judith reflection", { judithReflection });

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
      functions.logger.info("Judith reflection significance", {
        judithReflectionSignificance,
      });
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
      const relevantMemories = await searchEmbeddings(userId, reflectionEmbedding, 3);
      functions.logger.info("Relevant memories", { relevantMemories });

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
- Actively listen and ask targeted questions to encourage users to reflect on their thoughts and feelings
- Use concise, relatable examples and everyday language when explaining CBT techniques
- Tailor responses to match the length and tone of user inputs, ensuring a natural and engaging dialogue
- Promote emotional well-being and mental health by offering non-judgmental guidance and support
- Encourage users to challenge unhelpful thoughts and behaviors, and to develop healthier alternatives
- Facilitate goal-setting and achievement by providing brief, actionable steps and ongoing encouragement
- Utilize a Socratic approach, using casual questioning to help users arrive at their own conclusions
- Maintain ethical boundaries and uphold privacy, emphasizing your role as an AI friend rather than a licensed therapist
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
      functions.logger.info("OpenAI response", { openaiResponse });

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
      functions.logger.info("Chat response", { chatResponse });

      // Embed Judith's response in the memory stream
      const judithResponseSignificance = await getMemorySignificance(
        chatResponse || ""
      );
      functions.logger.info("Judith response significance", {
        judithResponseSignificance,
      });
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

const validateMemory = (memory: any, response: any) => {
  if (!memory) {
    handleError({
      err: ERROR_MESSAGES.MEMORY_REQUIRED,
      statusCode: STATUS_CODES.BAD_REQUEST,
      errorMessage: ERROR_MESSAGES.MEMORY_REQUIRED,
      response,
    });
    return false;
  }

  return true;
};

const validateMemorySignificance = (
  memorySignificance: any,
  openaiResponse: any,
  response: any
) => {
  if (Number.isNaN(memorySignificance)) {
    handleError({
      err: openaiResponse,
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      errorMessage: `OpenAI API returned a non-numeric response: ${memorySignificance}`,
      response,
    });
    return false;
  }

  if (memorySignificance < 1 || memorySignificance > 10) {
    handleError({
      err: openaiResponse,
      statusCode: STATUS_CODES.INTERNAL_SERVER_ERROR,
      errorMessage: `OpenAI API returned a number outside of the range 1-10: ${memorySignificance}`,
      response,
    });
    return false;
  }

  return true;
};

const getMemorySignificance = async (
  memory: string
): Promise<number | null> => {
  try {
    const isValid = validateMemory(memory, null);
    if (!isValid) return null;

    const openaiResponse = await openaiClient.createChatCompletion({
      model: "gpt-3.5-turbo",
      max_tokens: 10,
      temperature: 0.0,
      messages: [
        {
          role: "system",
          content: `You are MemorySignificanceGPT. When given a memory, you respond with a number between 1 and 10 (inclusive) that classifies the significance of the memory. A 1 would indicate an almost totally insignificant memory, like someone saying "hello". A 10 would indicate a tremendously significant memory, like getting married or losing a loved one.

The memories will always be a single message or an exchange of messages. You should focus on the significance of the user messages, and only use the assistant messages for context.

Respond concisely. Never repeat the question or the memory, never clarify your classification. Always respond with just the number denoting the significance of the memory the user provided.`,
        },
        {
          role: "user",
          content: memory,
        },
      ],
    });

    if (openaiResponse.status !== 200) {
      console.error(openaiResponse);
      functions.logger.error(openaiResponse);
      return null;
    }

    // Validate that the response is a number between 1 and 10
    const memorySignificance = Number(
      openaiResponse.data.choices[0].message?.content.trim()
    );

    const isValidMemorySignificance = validateMemorySignificance(
      memorySignificance,
      openaiResponse,
      null
    );
    if (!isValidMemorySignificance) return null;

    return memorySignificance;
  } catch (err: any) {
    console.error(err);
    functions.logger.error(err);
    return null;
  }
};
