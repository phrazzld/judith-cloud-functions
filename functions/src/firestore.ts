import * as functions from "firebase-functions";
import { firestore } from "./firebase";
import { Memory, Message } from "./types";

export const createMemoryDocument = async (
  userId: string,
  memoryData: Memory
): Promise<void> => {
  try {
    const userRef = firestore.collection("users").doc(userId);
    await userRef.collection("memories").doc().set(memoryData);
  } catch (err: any) {
    console.error(err);
    functions.logger.error(err);
    throw new Error("Error creating memory document");
  }
};

export const createMessageDocument = async (
  userId: string,
  messageData: Message
): Promise<void> => {
  try {
    const userRef = firestore.collection("users").doc(userId);
    await userRef.collection("messages").doc().set(messageData);
  } catch (err: any) {
    console.error(err);
    functions.logger.error(err);
    throw new Error("Error creating message document");
  }
};
