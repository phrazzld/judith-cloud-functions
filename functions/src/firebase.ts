import * as firebaseAdmin from "firebase-admin";
import serviceAccount from "../service-account-key.json";

firebaseAdmin.initializeApp({
  credential: firebaseAdmin.credential.cert(serviceAccount as any)
});

export const admin = firebaseAdmin;
export const firestore = admin.firestore();
