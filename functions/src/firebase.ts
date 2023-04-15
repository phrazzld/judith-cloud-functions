import * as firebaseAdmin from "firebase-admin";
import prodServiceAccount from "../service-account-key-prod.json";
import stagingServiceAccount from "../service-account-key-staging.json";

const serviceAccount =
  process.env.GCLOUD_PROJECT === "judith-beck"
    ? prodServiceAccount
    : stagingServiceAccount;

firebaseAdmin.initializeApp({
  credential: firebaseAdmin.credential.cert(serviceAccount as any),
});

export const admin = firebaseAdmin;
export const firestore = admin.firestore();
