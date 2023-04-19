import { ERROR_MESSAGES } from "./constants";
import { OpenAIChatMessage } from "./types";

export const validateMessages = (messages: OpenAIChatMessage[]): void => {
  if (!messages) {
    throw new Error(ERROR_MESSAGES.MESSAGES_REQUIRED);
  }

  // Validate that messages is an array of objects with a role and content
  if (!Array.isArray(messages)) {
    throw new Error(ERROR_MESSAGES.MESSAGES_ARRAY);
  }

  for (const message of messages) {
    if (
      typeof message !== "object" ||
      !message.role ||
      !message.content ||
      typeof message.role !== "string" ||
      typeof message.content !== "string"
    ) {
      throw new Error(ERROR_MESSAGES.MESSAGES_OBJECTS);
    }
  }
};

export const validateMemory = (memoryContent: string): void => {
  if (!memoryContent) {
    throw new Error(ERROR_MESSAGES.MEMORY_REQUIRED);
  }
};

export const validateMemorySignificance = (
  memorySignificance: string | number
): void => {
  if (Number.isNaN(memorySignificance)) {
    throw new Error(
      `OpenAI API returned a non-numeric response: ${memorySignificance}`
    );
  }

  if (memorySignificance < 1 || memorySignificance > 10) {
    throw new Error(
      `OpenAI API returned a number outside of the range 1-10: ${memorySignificance}`
    );
  }
};
