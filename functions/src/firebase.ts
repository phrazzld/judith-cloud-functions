import * as firebaseAdmin from "firebase-admin";
import prodServiceAccount from "../service-account-key-prod.json";
import stagingServiceAccount from "../service-account-key-staging.json";

const serviceAccount =
  process.env.NODE_ENV === "production"
    ? prodServiceAccount
    : stagingServiceAccount;

firebaseAdmin.initializeApp({
  credential: firebaseAdmin.credential.cert(serviceAccount as any),
});

export const admin = firebaseAdmin;
export const firestore = admin.firestore();
