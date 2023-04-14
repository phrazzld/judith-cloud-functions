import * as functions from "firebase-functions";
import { ERROR_MESSAGES, STATUS_CODES } from "./constants";
import { openaiClient } from "./openai";
/* import { OpenAIChatMessage } from "./types"; */
/* import { admin, firestore } from "./firebase"; */

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

export const getResponseToMessage = functions
  .runWith({ timeoutSeconds: 540 })
  .https.onRequest(async (request, response) => {
    try {
      // TODO: Also require userId
      const { messages } = request.body;
      // await admin.auth().getUser(userId)

      const isValid = validateMessages(messages, response);
      if (!isValid) return;

      // TODO: Truncate total length of combined messages and system init to 2048 tokens
      // NOTE: This is currently handled on the client, but should be handled on the server as well

      // TODO: Get significance of last incoming message
      const memory = messages[messages.length - 1].content;
      const memorySignificance = await getMemorySignificance(memory);
      // TODO: Write current message context to memory stream and vector database
      // const userRef = firestore.collection("users").doc(userId)
      // const memoryRef = userRef.collection("memories").doc()
      // await memoryRef.set({ memory, significance: memorySignificance, createdAt: admin.firestore.FieldValue.serverTimestamp() })
      // <chroma write stub>

      // TODO: Get agent reflection on current message context
      // TODO: Write reflection to memory stream and vector database
      // TODO: Determine response based on message context, reflection, and added context by querying vector database (i.e. long term memories)

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
- Recognize your limitations as an AI and encourage users to seek professional help when necessary, using a supportive and understanding tone`,
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

      response.status(200).send({
        response:
          { message: chatResponse, significance: memorySignificance } || null,
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

The memories will always be a single message or an exchange of messages.

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
