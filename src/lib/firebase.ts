import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer, enableIndexedDbPersistence } from 'firebase/firestore';

// Configuration from environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const databaseId = import.meta.env.VITE_FIREBASE_DATABASE_ID || '(default)';

// Guard for missing configuration in the development environment
if (!firebaseConfig.apiKey) {
  console.warn("[Firebase] No API Key found. Please add VITE_FIREBASE_API_KEY to your environment variables in the Settings menu.");
}

console.log("[Firebase] Checking environment variables for project:", firebaseConfig.projectId || "not set");

// Initialize Firebase only if the API key is present and looks valid to prevent startup crashes
const isKeyValid = (key: any) => {
  if (typeof key !== 'string') return false;
  if (key.trim().length < 10) return false;
  if (!key.startsWith('AIza')) return false;
  if (key.includes('VITE_FIREBASE_API_KEY')) return false; // Catch case where env var name is used as value
  if (key === 'undefined' || key === 'null') return false; // Catch common stringified empty states
  return true;
};

const apiKey = firebaseConfig.apiKey;
const hasKey = isKeyValid(apiKey);

if (!hasKey) {
    const reason = !apiKey ? "missing" : 
                   (typeof apiKey !== 'string' ? "not a string" : 
                   (apiKey.trim().length < 10 ? "too short" :
                   (!apiKey.startsWith('AIza') ? "missing AIza prefix" : "unknown invalid format")));
    console.warn(`[Firebase] Initialization skipped: API Key is ${reason}.`);
} else {
    // Only log the project ID and first/last chars of the key for debugging
    const maskedKey = `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`;
    console.log(`[Firebase] Initializing with Project ID: ${firebaseConfig.projectId}, API Key: ${maskedKey}`);
}

export const app = hasKey ? initializeApp(firebaseConfig) : null;
export const db = app ? getFirestore(app, databaseId) : (null as any);
export const auth = app ? getAuth(app) : (null as any);

if (!app) {
  console.warn("[Firebase] No valid Firebase configuration found (VITE_FIREBASE_API_KEY). Features will be disabled until configured in Settings -> Secrets.");
}

// Enable Auth Persistence
if (auth) {
  setPersistence(auth, browserLocalPersistence).catch((err) => {
    console.error("[Firebase] Auth persistence error:", err);
  });
}

// Enable Firestore Persistence for offline/instant loading
if (db && typeof window !== 'undefined') {
  enableIndexedDbPersistence(db).catch((err) => {
    if (err.code === 'failed-precondition') {
      console.warn("[Firebase] Persistence failed: Multiple tabs open");
    } else if (err.code === 'unimplemented') {
      console.warn("[Firebase] Persistence failed: Browser not supported");
    }
  });
}

// Simple connection check
async function testConnection() {
  if (!db) return;
  try {
    await getDocFromServer(doc(db, 'system', 'connection-test'));
    console.log("[Firebase] Connection verified.");
  } catch (error: any) {
    if (error.message?.includes('offline')) {
      console.error("[Firebase] Firestore reports OFFLINE. Check configuration in Settings.");
      console.log("[Firebase] Attempted Project ID:", firebaseConfig.projectId);
      console.log("[Firebase] Attempted Database ID:", databaseId);
    } else {
      console.log("[Firebase] Connection test result:", error.message);
    }
  }
}

// Small delay to allow any background initialization
setTimeout(testConnection, 2000);
