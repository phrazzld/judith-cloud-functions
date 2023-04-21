export const STATUS_CODES = {
  BAD_REQUEST: 400,
  OK: 200,
  INTERNAL_SERVER_ERROR: 500,
};

export const ERROR_MESSAGES = {
  MESSAGES_REQUIRED: "Messages is required",
  MESSAGES_ARRAY: "Messages must be an array",
  MESSAGES_OBJECTS: "Messages must be an array of objects",
  MEMORY_REQUIRED: "Memory is required",
  OPENAI_ERROR: "OpenAI API returned an error",
  GENERIC: "Something went wrong"
};

export const ELEVEN_LABS_BASE_URL = "https://api.elevenlabs.io/v1/text-to-speech";
export const VOICE_ID = "EXAVITQu4vr4xnSDxMaL"; // Bella
/* const VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel */

export const DEFAULT_MEMORY_SIGNIFICANCE = 3;
