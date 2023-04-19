import * as admin from "firebase-admin";

export interface OpenAIChatMessage {
  role: string;
  content: string;
}

export interface OpenAIApiResponse {
  status: number;
  data: {
    choices: [
      {
        message: {
          content: string;
        };
      }
    ];
  };
}

export type MemoryType = "judithReflection" | "judithMessage" | "userMessage";

export interface Message {
  sender: "user" | "bot";
  text: string;
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
}

export interface Memory {
  memoryType: MemoryType;
  memory: string;
  embedding: number[];
  significance: number | null;
  triggeredMemories?: string;
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  lastAccessedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
}
