import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { ERROR_MESSAGES, STATUS_CODES } from "./constants";
import { firestore } from "./firebase";
import { openaiClient } from "./openai";
import { Memory } from "./types";

interface HandleErrorParams {
  err: any;
  statusCode: number;
  errorMessage: string;
  response: any;
}

export const handleError = (params: HandleErrorParams) => {
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

export const validateMessages = (messages: any, response: any) => {
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

const calculateWeightedScore = (
  similarity: number,
  significance: number,
  lastAccessedAt: admin.firestore.Timestamp,
  currentTime: admin.firestore.Timestamp,
  timeDecayFactor: number,
  significanceWeight: number,
  similarityWeight: number
): number => {
  const timeElapsed = currentTime.toMillis() - lastAccessedAt.toMillis();
  const timeDecay = Math.exp(-timeElapsed * timeDecayFactor);
  return (
    similarity * similarityWeight +
    significance * significanceWeight * timeDecay
  );
};

export const searchEmbeddings = async (
  userId: string,
  embedding: number[],
  numResults: number,
  timeDecayFactor = 1e-10,
  significanceWeight = 0.5,
  similarityWeight = 0.5
) => {
  if (significanceWeight + similarityWeight !== 1) {
    throw new Error(
      "The sum of significanceWeight and similarityWeight must be equal to 1."
    );
  }

  const currentTime = admin.firestore.Timestamp.now();
  const userRef = firestore.collection("users").doc(userId);
  const memoryStream = await userRef.collection("memories").get();

  const scores = memoryStream.docs.map((doc) => {
    const {
      embedding: memoryEmbedding,
      significance,
      lastAccessedAt,
    } = doc.data() as Memory;
    const similarity = cosineSimilarity(embedding, memoryEmbedding);
    const weightedScore = calculateWeightedScore(
      similarity,
      significance,
      lastAccessedAt || currentTime,
      currentTime,
      timeDecayFactor,
      significanceWeight,
      similarityWeight
    );
    return { weightedScore, doc };
  });

  const sortedScores = scores
    .sort((a, b) => b.weightedScore - a.weightedScore)
    .slice(0, numResults);

  // Update lastAccessedAt for the documents in sortedScores
  const updatePromises = sortedScores.map(({ doc }) => {
    return doc.ref.update({ lastAccessedAt: currentTime });
  });

  await Promise.all(updatePromises);

  return sortedScores;
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

/* export const searchEmbeddings = async ( */
/*   userId: string, */
/*   embedding: number[], */
/*   numResults: number */
/* ) => { */
/*   const userRef = firestore.collection("users").doc(userId); */
/*   const memoryStream = await userRef.collection("memories").get(); */
/*   const similarities = memoryStream.docs.map((doc) => { */
/*     const { embedding: memoryEmbedding } = doc.data(); */
/*     const similarity = cosineSimilarity(embedding, memoryEmbedding); */
/*     return { similarity, doc }; */
/*   }); */
/*   const slicedSimilarities = similarities */
/*     .sort((a, b) => b.similarity - a.similarity) */
/*     .slice(0, numResults); */
/*   return slicedSimilarities; */
/* }; */

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

export const getMemorySignificance = async (
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

The memories will always be a single message. You should focus on the significance of the user messages, and only use the assistant messages for context.

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
