import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { ERROR_MESSAGES } from "./constants";
import { firestore } from "./firebase";
import { openaiClient } from "./openai";
import { Memory } from "./types";

const calculateWeightedScore = (
  similarity: number,
  significance: number | null,
  lastAccessedAt: admin.firestore.Timestamp,
  currentTime: admin.firestore.Timestamp,
  timeDecayFactor: number,
  significanceWeight: number,
  similarityWeight: number
): number => {
  const timeElapsed = currentTime.toMillis() - lastAccessedAt.toMillis();
  const timeDecay = Math.exp(-timeElapsed * timeDecayFactor);
  // Fully discount significance if it's null
  significance = significance || 0;
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
  try {
    if (significanceWeight + similarityWeight !== 1) {
      throw new Error(
        "The sum of significanceWeight and similarityWeight must be equal to 1."
      );
    }

    const currentTime = admin.firestore.Timestamp.now();
    const userRef = firestore.collection("users").doc(userId);
    const memoryStream = await userRef.collection("memories").get();

    const scores = memoryStream.docs.map((doc: any) => {
      const {
        embedding: memoryEmbedding,
        significance,
        lastAccessedAt,
      } = doc.data() as Memory;
      const similarity = cosineSimilarity(embedding, memoryEmbedding);
      const weightedScore = calculateWeightedScore(
        similarity,
        significance,
        (lastAccessedAt || currentTime) as admin.firestore.Timestamp,
        currentTime,
        timeDecayFactor,
        significanceWeight,
        similarityWeight
      );
      return { weightedScore, doc };
    });

    const sortedScores = scores
      .sort((a: any, b: any) => b.weightedScore - a.weightedScore)
      .slice(0, numResults);

    // Update lastAccessedAt for the documents in sortedScores
    const updatePromises = sortedScores.map(({ doc }) => {
      return doc.ref.update({ lastAccessedAt: currentTime });
    });

    await Promise.all(updatePromises);

    return sortedScores;
  } catch (err: any) {
    console.error(err);
    functions.logger.error(err);
    throw new Error("Error searching embeddings.");
  }
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

export const getEmbedding = async (content: string): Promise<number[]> => {
  try {
    const openaiResponse = await openaiClient.createEmbedding({
      model: "text-embedding-ada-002",
      input: content,
    });

    if (openaiResponse.status !== 200) {
      console.error(openaiResponse);
      functions.logger.error(openaiResponse);
      throw new Error(ERROR_MESSAGES.OPENAI_ERROR);
    }

    const embedding = openaiResponse.data.data[0].embedding;

    return embedding;
  } catch (err: any) {
    console.error(err);
    functions.logger.error(err);
    throw new Error("Error getting embedding.");
  }
};
