import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';


// Allow environment variables to override if present
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const databaseId = import.meta.env.VITE_FIREBASE_DATABASE_ID || '(default)';

console.log("[Firebase] Initializing with project:", firebaseConfig.projectId);

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, databaseId);
export const auth = getAuth(app);

// Simple connection check
async function testConnection() {
  try {
    // Attempting a simple server-side fetch to verify connectivity
    await getDocFromServer(doc(db, 'config', 'setup'));
    console.log("[Firebase] Connection verified.");
  } catch (error: any) {
    if (error.message?.includes('offline')) {
      console.error("[Firebase] Firestore reports OFFLINE. Check if the project ID and database ID are correct in the Firebase Console.");
      console.log("[Firebase] Attempted Project ID:", firebaseConfig.projectId);
      console.log("[Firebase] Attempted Database ID:", databaseId);
    } else {
      console.log("[Firebase] Connection test info:", error.message);
    }
  }
}

// Small delay to allow any background initialization
setTimeout(testConnection, 2000);
