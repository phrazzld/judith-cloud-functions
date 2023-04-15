
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
      },
    ];
  };
}

export interface Memory {
  memoryType: "judithReflection" | "judithMessage" | "userMessage";
  memory: string;
  embedding: number[];
  // TODO: Properly type createdAt
  createdAt: any;
}
