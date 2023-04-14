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
