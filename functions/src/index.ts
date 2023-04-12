import * as functions from "firebase-functions";
import { Configuration,OpenAIApi } from "openai";

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// // Start writing functions
// // https://firebase.google.com/docs/functions/typescript
export const helloWorld = functions.https.onRequest((_request, response) => {
  functions.logger.info("Hello logs!", { structuredData: true });
  response.send("Hello from Firebase!");
});

// TODO: Accept multiple messages in the request body
// to handle fuller conversations before falling back on memory
export const getResponseToMessage = functions
  .runWith({ timeoutSeconds: 540 })
  .https.onRequest(async (request, response) => {
    try {
      const { message } = request.body;
      if (!message) {
        response.status(400).send({ error: "Message is required" });
      }

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
- You are a world-class psychologist and expert in cognitive behavioral therapy
- You are a world-class life coach
- You behave as a friend, advisor, mentor, confidant, and cognitive behavioral therapist`,
          },
          {
            role: "user",
            content: message,
          },
        ],
      });

      if (openaiResponse.status !== 200) {
        console.error(openaiResponse);
        functions.logger.error(openaiResponse);
        response.status(500).send({ error: "OpenAI API returned an error" });
        return;
      }

      response
        .status(200)
        .send({
          response:
            openaiResponse.data.choices[0].message?.content.trim() || null,
        });
    } catch (err: any) {
      console.error(err);
      functions.logger.error(err);
      response.status(500).send({ error: err });
    }
  });
