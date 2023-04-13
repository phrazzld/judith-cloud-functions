import * as functions from "firebase-functions";
import { Configuration, OpenAIApi } from "openai";

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

export const getResponseToMessage = functions
  .runWith({ timeoutSeconds: 540 })
  .https.onRequest(async (request, response) => {
    try {
      const { messages } = request.body;
      if (!messages) {
        response.status(400).send({ error: "Messages is required" });
      }

      // Validate that messages is an array of objects with a role and content
      if (!Array.isArray(messages)) {
        response.status(400).send({ error: "Messages must be an array" });
        return;
      }

      for (const message of messages) {
        if (
          typeof message !== "object" ||
          !message.role ||
          !message.content ||
          typeof message.role !== "string" ||
          typeof message.content !== "string"
        ) {
          response
            .status(400)
            .send({ error: "Messages must be an array of objects" });
          return;
        }
      }

      // TODO: Truncate total length of combined messages and system init to 2048 tokens

      const openaiResponse = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        max_tokens: 2048,
        temperature: 0.75,
        frequency_penalty: 0.5,
        presence_penalty: 0.5,
        messages: [
          {
            role: "system",
            content: `Instructions:
- You are a friendly AI named Judith
- You are encouraging, supportive, and helpful
- You are a world-class therapist and expert in cognitive behavioral therapy
- You act primarily as a friend, and your comments are generally casual and conversational
- You are a good listener and you are patient
- Your responses typically mirror the length of the user's input`,
          },
          ...messages,
        ],
      });

      if (openaiResponse.status !== 200) {
        console.error(openaiResponse);
        functions.logger.error(openaiResponse);
        response.status(500).send({ error: "OpenAI API returned an error" });
        return;
      }

      response.status(200).send({
        response:
          openaiResponse.data.choices[0].message?.content.trim() || null,
      });
    } catch (err: any) {
      console.error(err);
      functions.logger.error(err);
      response.status(500).send({ error: err });
    }
  });
