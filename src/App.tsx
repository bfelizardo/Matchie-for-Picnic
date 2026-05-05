import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Minus,
  ShoppingCart, 
  Trash2, 
  Check, 
  Settings, 
  Search, 
  LogOut, 
  ShoppingBasket,
  ChevronRight,
  AlertCircle,
  Loader2,
  RefreshCw,
  Sparkles,
  Heart,
  Shield,
  Brain,
  X
} from 'lucide-react';
import { auth, db } from './lib/firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  User
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  onSnapshot, 
  deleteDoc, 
  doc, 
  updateDoc, 
  serverTimestamp,
  orderBy,
  runTransaction,
  deleteField,
  getDoc,
  setDoc,
  FieldPath
} from 'firebase/firestore';
import { picnicApi } from './lib/picnic';
import { autoMatchProduct, autoMatchMultipleProducts, PicnicProduct } from './lib/gemini';
import { MemoryManager } from './components/MemoryManager';
import { FavouritesList } from './components/FavouritesList';
import { UserManagement } from './components/UserManagement';
import { cn } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType } from './lib/firebaseUtils';

// Types
interface ShoppingListItem {
  id: string;
  name: string;
  originalInput?: string;
  count: number;
  status: 'pending' | 'matched' | 'unmatched' | 'in_basket';
  matchedProduct?: PicnicProduct;
  candidates?: PicnicProduct[];
  addedByName?: string;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<'admin' | 'member' | null>(null);
  const [isAccessDenied, setIsAccessDenied] = useState(false);
  const [picnicToken, setPicnicToken] = useState<string | null>(localStorage.getItem('picnicToken'));
  const [picnicEmail, setPicnicEmail] = useState<string | null>(localStorage.getItem('picnicEmail'));
  const [favourites, setFavourites] = useState<PicnicProduct[]>([]);
  const [items, setItems] = useState<ShoppingListItem[]>([]);
  const [newItemName, setNewItemName] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showUserManagement, setShowUserManagement] = useState(false);
  const [loading, setLoading] = useState(true);
  const [matchingStatus, setMatchingStatus] = useState<Record<string, boolean>>({});

  const toTitleCase = (str: string) => {
    if (!str || typeof str !== 'string') return '';
    return str
      .trim()
      .replace(/[.,/#!$%^&*;:{}=\-_`~()]+$/, '') // Strip trailing punctuation
      .split(/\s+/)
      .map(word => word ? (word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()) : '')
      .join(' ');
  };

  const normalizeName = (name: string) => (name || '').trim().toLowerCase();

  const mergedItems = React.useMemo(() => {
    const groups: Record<string, {
      name: string;
      count: number;
      items: ShoppingListItem[];
    }> = {};

    items.forEach(item => {
      const key = normalizeName(item.name);
      if (!groups[key]) {
        groups[key] = {
          name: toTitleCase(item.name),
          count: 0,
          items: []
        };
      }
      groups[key].count += item.count || 1;
      groups[key].items.push(item);
    });

    return Object.entries(groups).map(([key, group]) => {
      // Pick representative item: matched one first, otherwise the first one
      const matchedItem = group.items.find(i => i.status === 'matched');
      const representative = matchedItem || group.items[0];

      return {
        ...representative,
        name: group.name,
        count: group.count,
        originalIds: group.items.map(i => i.id),
        // Use a stable ID for the merged group if possible, or just the representative's ID
        id: `merged-${key}` 
      };
    });
  }, [items]);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
  }, []);

  useEffect(() => {
    if (!user) {
      setCurrentUserRole(null);
      setIsAccessDenied(false);
      setLoading(false);
      return;
    }

    const checkAccess = async () => {
      setLoading(true);
      const email = user.email?.toLowerCase();
      if (!email) {
        setIsAccessDenied(true);
        setLoading(false);
        return;
      }

      const userRef = doc(db, 'app_users', email);
      const setupRef = doc(db, 'config', 'setup');

      try {
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          setCurrentUserRole(userSnap.data().role);
          setIsAccessDenied(false);
        } else {
          // Check if bootstrapping is needed
          const setupSnap = await getDoc(setupRef);
          if (!setupSnap.exists()) {
            await setDoc(userRef, {
              email,
              role: 'admin',
              addedAt: serverTimestamp(),
              addedBy: 'system_bootstrap'
            });
            await setDoc(setupRef, { setupComplete: true });
            setCurrentUserRole('admin');
            setIsAccessDenied(false);
          } else {
            setCurrentUserRole(null);
            setIsAccessDenied(true);
          }
        }
      } catch (e) {
        handleFirestoreError(e, OperationType.GET, 'access_check');
        setIsAccessDenied(true);
      } finally {
        setLoading(false);
      }
    };

    checkAccess();
  }, [user]);

  useEffect(() => {
    if (!user || loading || isAccessDenied || !currentUserRole) return;
    const unsub = onSnapshot(doc(db, 'config', 'picnic'), (docSnap) => {
      if (docSnap.exists() && docSnap.data().picnicToken) {
        setPicnicToken(docSnap.data().picnicToken);
        setPicnicEmail(docSnap.data().email || null);
        localStorage.setItem('picnicToken', docSnap.data().picnicToken);
        if (docSnap.data().email) localStorage.setItem('picnicEmail', docSnap.data().email);
      } else {
        setPicnicToken(null);
        setPicnicEmail(null);
        localStorage.removeItem('picnicToken');
        localStorage.removeItem('picnicEmail');
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'config/picnic');
    });
    return unsub;
  }, [user, isAccessDenied, loading, currentUserRole]);

  useEffect(() => {
    if (!user || loading || isAccessDenied || !currentUserRole) return;
    const q = query(collection(db, 'items'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      const newItems = snapshot.docs.map(doc => {
        const data = doc.data();
        let matchedProduct = data.matchedProduct;
        let status = data.status;
        let candidates = data.candidates;

        // Fix malformed ghost items where matchedProduct was actually candidates
        if (matchedProduct && (!matchedProduct.id || !matchedProduct.name)) {
          if (matchedProduct.candidates && Array.isArray(matchedProduct.candidates)) {
            candidates = matchedProduct.candidates;
          }
          matchedProduct = null;
          status = 'unmatched';
        }

        return {
          id: doc.id,
          ...data,
          matchedProduct,
          candidates,
          status
        };
      }) as ShoppingListItem[];
      setItems(newItems);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'items');
    });
  }, [user, isAccessDenied, loading, currentUserRole]);

  useEffect(() => {
    if (picnicToken) {
      loadPicnicData();
    }
  }, [picnicToken]);

  const [refreshing, setRefreshing] = useState(false);
  const loadPicnicData = async () => {
    if (!picnicToken) return;
    setRefreshing(true);
    try {
      const data = await picnicApi.getFavourites(picnicToken);
      if (Array.isArray(data)) {
        setFavourites(data as PicnicProduct[]);
      }
    } catch (e) {
      console.error("Failed to load favourites", e);
    } finally {
      setRefreshing(false);
    }
  };

  const [preferences, setPreferences] = useState<Record<string, any>>({});
  
  const savePreferenceUpdate = async (updateData: Record<string, any>) => {
    if (!user) return;
    
    // Safety check: Firestore doesn't allow undefined values.
    // We clean the updateData to ensure no undefineds are passed.
    const cleanedUpdate: Record<string, any> = {};
    Object.entries(updateData).forEach(([key, value]) => {
      if (value !== undefined) {
        cleanedUpdate[key] = value;
      }
    });

    if (Object.keys(cleanedUpdate).length === 0) return;

    const prefRef = doc(db, 'shared_preferences', 'matching');
    try {
      await updateDoc(prefRef, cleanedUpdate);
    } catch (e: any) {
      if (e.code === 'not-found' || (e.message && e.message.includes('No document to update'))) {
        try {
          await setDoc(prefRef, { updatedAt: serverTimestamp() }, { merge: true });
          await updateDoc(prefRef, cleanedUpdate);
        } catch (innerErr) {
          handleFirestoreError(innerErr, OperationType.WRITE, 'shared_preferences/matching');
        }
      } else {
        handleFirestoreError(e, OperationType.UPDATE, 'shared_preferences/matching');
      }
    }
  };

  const [view, setView] = useState<'list' | 'memory' | 'favourites'>(() => {
    return (localStorage.getItem('picnic_view') as any) || 'list';
  });

  useEffect(() => {
    localStorage.setItem('picnic_view', view);
  }, [view]);

  const [manualSearchItem, setManualSearchItem] = useState<ShoppingListItem | null>(null);
  const [candidateSelectionItem, setCandidateSelectionItem] = useState<ShoppingListItem | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Auto-hide AI error after 8 seconds
  useEffect(() => {
    if (aiError) {
      const timer = setTimeout(() => setAiError(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [aiError]);

  const handleAiError = (error: any) => {
    const message = error?.message || "";
    console.warn("Caught AI Error:", message, error);
    
    if (message.includes("AI_SERVICE_QUOTA_EXCEEDED") || message.includes("RESOURCE_EXHAUSTED") || message.includes("quota")) {
      setAiError("AI Quota exceeded. Please try manual matching for now.");
    } else if (message.includes("AI_SERVICE_TIMEOUT")) {
      setAiError("AI Match timed out. Please try again or match manually.");
    } else if (message.includes("AI_SERVICE_UNAVAILABLE") || message.includes("AI_SERVICE_RATE_LIMITED") || message.includes("rate limit")) {
      setAiError("AI Service is temporarily busy. Manual matching is recommended.");
    } else if (message.includes("safety") || message.includes("blocked")) {
      setAiError("AI blocked the request for safety reasons. Please use manual match.");
    } else {
      setAiError("AI Service is currently unavailable. Please match manually.");
    }
  };

  useEffect(() => {
    if (!user || loading || isAccessDenied || !currentUserRole) return;
    const prefRef = doc(db, 'shared_preferences', 'matching');
    return onSnapshot(prefRef, (doc) => {
      if (doc.exists()) {
        setPreferences(doc.data().pastMatches || {});
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'shared_preferences/matching');
    });
  }, [user, loading, isAccessDenied, currentUserRole]);

  const isMatchingRef = React.useRef(false);

  useEffect(() => {
    if (!picnicToken || favourites.length === 0 || !user || isMatchingRef.current) return;

    const matchPendingItems = async () => {
      const pendingItems = items.filter(i => i.status === 'pending' && !matchingStatus[i.id]);
      if (pendingItems.length === 0) return;

      isMatchingRef.current = true;
      
      const newStatusUpdates: Record<string, boolean> = {};
      pendingItems.forEach(item => newStatusUpdates[item.id] = true);
      setMatchingStatus(prev => ({ ...prev, ...newStatusUpdates }));
      
      try {
        const itemNames = pendingItems.map(i => i.name);
        const matches = await autoMatchMultipleProducts(itemNames, favourites, preferences);
        
        const memoryUpdates: Record<string, any> = {};

        for (const item of pendingItems) {
          const result = matches[item.name];
          if (result.product) {
            try {
              await updateDoc(doc(db, 'items', item.id), {
                matchedProduct: result.product,
                status: 'matched'
              });
            } catch (err) {
              handleFirestoreError(err, OperationType.UPDATE, `items/${item.id}`);
            }
            // Automatically save successful AI matches to the Matching Brain
            memoryUpdates[`pastMatches.${(item.name || "").toLowerCase()}`] = result.product;
          } else if (result.candidates && result.candidates.length > 0) {
            try {
              await updateDoc(doc(db, 'items', item.id), {
                candidates: result.candidates,
                status: 'unmatched'
              });
            } catch (err) {
              handleFirestoreError(err, OperationType.UPDATE, `items/${item.id}`);
            }
            memoryUpdates[`pastMatches.${(item.name || "").toLowerCase()}`] = { candidates: result.candidates };
          } else {
            try {
              await updateDoc(doc(db, 'items', item.id), {
                matchedProduct: null,
                status: 'unmatched'
              });
            } catch (err) {
              handleFirestoreError(err, OperationType.UPDATE, `items/${item.id}`);
            }
          }
        }

        if (Object.keys(memoryUpdates).length > 0) {
          await savePreferenceUpdate(memoryUpdates);
        }
      } catch (e) {
        handleAiError(e);
        for (const item of pendingItems) {
          await updateDoc(doc(db, 'items', item.id), { status: 'unmatched' });
        }
      } finally {
        const resetStatusUpdates: Record<string, boolean> = {};
        pendingItems.forEach(item => resetStatusUpdates[item.id] = false);
        setMatchingStatus(prev => ({ ...prev, ...resetStatusUpdates }));
      }

      isMatchingRef.current = false;
    };

    matchPendingItems();
  }, [items.filter(i => i.status === 'pending').length, favourites.length, picnicToken, user]);

  const parseItemName = (input: string) => {
    let name = input.trim();
    let count = 1;

    // Pattern: "2 Milk" or "2x Milk"
    const startMatch = name.match(/^(\d+)x?\s+(.*)$/i);
    if (startMatch) {
      return { count: parseInt(startMatch[1]), name: startMatch[2] };
    }

    // Pattern: "Milk 2" or "Milk 2x"
    const endMatch = name.match(/^(.*)\s+(\d+)x?$/i);
    if (endMatch) {
      return { count: parseInt(endMatch[2]), name: endMatch[1] };
    }

    return { name, count };
  };

  useEffect(() => {
    const handler = async (e: any) => {
      const product = e.detail as PicnicProduct;
      if (!user) return;
      try {
        await addDoc(collection(db, 'items'), {
          name: product.name,
          count: 1,
          status: 'matched',
          matchedProduct: product,
          addedBy: user.uid,
          addedByName: user.displayName || user.email?.split('@')[0],
          createdAt: serverTimestamp()
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, 'items');
      }
    };
    window.addEventListener('add-favourite', handler);
    return () => window.removeEventListener('add-favourite', handler);
  }, [user]);

  const addItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim() || !user) return;
    
    const { name, count } = parseItemName(newItemName);
    const originalInput = newItemName.trim();
    setNewItemName('');

    try {
      const normalizedName = toTitleCase(name);
      await addDoc(collection(db, 'items'), {
        name: normalizedName,
        originalInput: originalInput,
        count,
        status: 'pending',
        createdAt: serverTimestamp(),
        addedBy: user.uid,
        addedByName: user.displayName || user.email?.split('@')[0]
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'items');
    }
  };

  const removeItem = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'items', id));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `items/${id}`);
    }
  };

  const handleSyncMemory = async () => {
    if (!picnicToken || !user) return;
    setRefreshing(true);
    try {
      // 1. Refresh favourites first to get certain fresh data
      const freshFavourites = await picnicApi.getFavourites(picnicToken);
      if (Array.isArray(freshFavourites)) {
        setFavourites(freshFavourites as PicnicProduct[]);
      }

      // 2. Identify all products in pastMatches that need refreshment
      // We'll update products that exist in our fresh favourites list
      const favMap = new Map((freshFavourites as PicnicProduct[]).map(f => [f.id, f]));
      const prefRef = doc(db, 'shared_preferences', 'matching');
      
      const updateArgs: any[] = [];
      let hasUpdates = false;

      Object.entries(preferences).forEach(([term, dataValue]) => {
        const data = dataValue as any;
        let currentProductId = "";
        if (typeof data === 'object' && data !== null) {
          if (data.product && data.product.id) currentProductId = data.product.id;
          else if (data.id) currentProductId = data.id;
        } else if (typeof data === 'string') {
          currentProductId = data;
        }

        if (currentProductId && favMap.has(currentProductId)) {
          const freshProduct = favMap.get(currentProductId);
          // Check if data is actually different (simple check)
          const currentPrice = data.price || (data.product && data.product.price);
          if (freshProduct && freshProduct.price !== currentPrice) {
            updateArgs.push(new FieldPath('pastMatches', term), freshProduct);
            hasUpdates = true;
          }
        }
      });

      if (hasUpdates) {
        await (updateDoc as any)(prefRef, ...updateArgs);
      }
    } catch (e) {
      console.error("Failed to sync memory", e);
    } finally {
      setRefreshing(false);
    }
  };

  const handleUpdateMemory = async (term: string, product: PicnicProduct | null) => {
    if (!user) return;
    try {
      const prefRef = doc(db, 'shared_preferences', 'matching');
      const value = product === null ? deleteField() : product;
      
      try {
        await (updateDoc as any)(prefRef, new FieldPath('pastMatches', term), value);
      } catch (e: any) {
        if (e.code === 'not-found' || (e.message && e.message.includes('No document to update'))) {
          try {
            await setDoc(prefRef, { updatedAt: serverTimestamp() }, { merge: true });
            await (updateDoc as any)(prefRef, new FieldPath('pastMatches', term), value);
          } catch (innerErr) {
            handleFirestoreError(innerErr, OperationType.WRITE, 'shared_preferences/matching');
          }
        } else {
          handleFirestoreError(e, OperationType.UPDATE, 'shared_preferences/matching');
        }
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, 'shared_preferences/matching');
    }
  };

  const handleBatchUpdateMemory = async (updates: Array<{ term: string, product: PicnicProduct | null }>) => {
    if (!user || updates.length === 0) return;
    try {
      const prefRef = doc(db, 'shared_preferences', 'matching');
      const updateArgs: any[] = [];
      
      updates.forEach(({ term, product }) => {
        updateArgs.push(new FieldPath('pastMatches', term), product === null ? deleteField() : product);
      });
      
      try {
        await (updateDoc as any)(prefRef, ...updateArgs);
      } catch (e: any) {
        if (e.code === 'not-found' || (e.message && e.message.includes('No document to update'))) {
          try {
            await setDoc(prefRef, { updatedAt: serverTimestamp() }, { merge: true });
            await (updateDoc as any)(prefRef, ...updateArgs);
          } catch (innerErr) {
            handleFirestoreError(innerErr, OperationType.WRITE, 'shared_preferences/matching');
          }
        } else {
          handleFirestoreError(e, OperationType.UPDATE, 'shared_preferences/matching');
        }
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, 'shared_preferences/matching');
    }
  };

  const handleRunAiMatchMemory = async (terms: string[], forceReview: boolean = false) => {
    if (!user || favourites.length === 0 || terms.length === 0) return {};
    try {
      const updateData: any = {};

      // Evaluate all terms in a single AI call to save quota and speed up
      const matches = await autoMatchMultipleProducts(terms, favourites, {});
      
      for (const term of terms) {
        if (matches[term]) {
          const matchResult = { ...matches[term] };
          
          // If forceReview is requested, we nullify the product but ensure it's in candidates
          // so it appears in the "Review" section in MemoryManager
          if (forceReview && matchResult.product) {
            const candidates = matchResult.candidates ? [...matchResult.candidates] : [];
            if (!candidates.some((c: any) => c.id === matchResult.product.id)) {
              candidates.unshift(matchResult.product);
            }
            matchResult.product = null;
            matchResult.candidates = candidates;
          }
          
          updateData[`pastMatches.${term}`] = matchResult;
          matches[term] = matchResult; // Update the returned object too
        }
      }
      
      if (Object.keys(updateData).length > 0) {
        await savePreferenceUpdate(updateData);
      }
      return matches;
    } catch (e) {
      handleAiError(e);
      return {};
    }
  };

  const triggerAiMatch = async (item: ShoppingListItem | any) => {
    if (!user || !picnicToken || favourites.length === 0) return;
    
    // Handle merged items
    const idsToUpdate = item.originalIds || [item.id];
    const nameForMatch = item.name;

    idsToUpdate.forEach((id: string) => {
      setMatchingStatus(prev => ({ ...prev, [id]: true }));
    });
    
    try {
      // 1. Remove the "learned" preference if it exists
      const itemKey = nameForMatch.toLowerCase();
      
      if (preferences[itemKey]) {
        const newPastMatches = { ...preferences };
        delete newPastMatches[itemKey];
        await savePreferenceUpdate({ pastMatches: newPastMatches });
      }

      // 2. Re-run AI match
      const result = await autoMatchProduct(nameForMatch, favourites, {});
      
      const newPreferencesObj: Record<string, any> = {};
      const normalizedQuery = (nameForMatch || "").toLowerCase();

      if (result.product) {
         newPreferencesObj[`pastMatches.${normalizedQuery}`] = result.product;
      } else if (result.candidates && result.candidates.length > 0) {
         newPreferencesObj[`pastMatches.${normalizedQuery}`] = { candidates: result.candidates };
      }

      if (Object.keys(newPreferencesObj).length > 0) {
        await savePreferenceUpdate(newPreferencesObj);
      }
      
      for (const id of idsToUpdate) {
        try {
          if (result.product) {
            await updateDoc(doc(db, 'items', id), {
              matchedProduct: result.product,
              status: 'matched'
            });
          } else if (result.candidates && result.candidates.length > 0) {
            await updateDoc(doc(db, 'items', id), {
              candidates: result.candidates,
              status: 'unmatched'
            });
          } else {
            await updateDoc(doc(db, 'items', id), {
              matchedProduct: null,
              status: 'unmatched'
            });
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `items/${id}`);
        }
      }
    } catch (e) {
      handleAiError(e);
    } finally {
      idsToUpdate.forEach((id: string) => {
        setMatchingStatus(prev => ({ ...prev, [id]: false }));
      });
    }
  };

  const updateMatch = async (item: ShoppingListItem | any, product: PicnicProduct) => {
    const itemName = item.name;

    if (item.id && item.id.startsWith('temp-')) {
      // This is a fake item created for MemoryManager review or Select Product
      if (item.originalTerms && Array.isArray(item.originalTerms)) {
        const updates = item.originalTerms.map((t: string) => ({ term: t, product }));
        await handleBatchUpdateMemory(updates);
      } else {
        await handleUpdateMemory(itemName, product);
      }
      
      // Update any unmatched items that have the exact same name
      const matchingItems = items.filter(i => 
        (i.name || "").toLowerCase() === (itemName || "").toLowerCase() &&
        i.status !== 'matched'
      );
      
      for (const i of matchingItems) {
        try {
          await updateDoc(doc(db, 'items', i.id), {
            matchedProduct: product,
            status: 'matched'
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `items/${i.id}`);
        }
      }
      return;
    }

    const idsToUpdate = item.originalIds || [item.id];

    for (const id of idsToUpdate) {
      try {
        await updateDoc(doc(db, 'items', id), {
          matchedProduct: product,
          status: 'matched'
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `items/${id}`);
      }
    }
    
    // Save preference for future learning
    if (user) {
      await handleUpdateMemory(normalizeName(itemName), product);
    }
  };

  const sendToPicnic = async () => {
    if (!picnicToken) return;
    
    const matchedItems = items.filter(i => i.status === 'matched' && i.matchedProduct);
    
    for (const item of matchedItems) {
      try {
        await picnicApi.addToBasket(picnicToken, item.matchedProduct!.id, item.count);
        // Remove item after success
        try {
          await deleteDoc(doc(db, 'items', item.id));
        } catch (delErr) {
          handleFirestoreError(delErr, OperationType.DELETE, `items/${item.id}`);
        }
      } catch (e) {
        console.error(`Failed to add ${item.name} to basket`, e);
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-rose-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-4">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-10 text-center border border-slate-200">
          <div className="w-16 h-16 bg-rose-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <ShoppingBasket className="w-8 h-8 text-rose-600" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2 tracking-tight">Matchie</h1>
          <p className="text-slate-500 mb-8 leading-relaxed">The intelligent shopping list that learns your favourites.</p>
          <button 
            onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}
            className="w-full py-4 px-6 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-2xl transition-all shadow-lg shadow-rose-200 active:scale-95"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  if (isAccessDenied) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-4">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-10 text-center border border-slate-200">
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Shield className="w-8 h-8 text-slate-500" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2 tracking-tight">Access Denied</h1>
          <p className="text-slate-500 mb-8 leading-relaxed">You do not have access to this Matchie shared list. Please ask your administrator to invite your email address: <strong className="text-slate-800">{user.email}</strong></p>
          <button 
            onClick={() => signOut(auth)}
            className="w-full py-3 px-6 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold rounded-xl transition-all"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  const updateCount = async (id: string, delta: number) => {
    // Check if it's a merged ID
    if (id.startsWith('merged-')) {
      const key = id.replace('merged-', '');
      const group = items.filter(i => normalizeName(i.name) === key);
      if (group.length > 0) {
        // Update the first item in the group
        const target = group[0];
        const newCount = Math.max(1, (target.count || 1) + delta);
        try {
          await updateDoc(doc(db, 'items', target.id), { count: newCount });
        } catch (e) {
          handleFirestoreError(e, OperationType.UPDATE, `items/${target.id}`);
        }
      }
      return;
    }

    const item = items.find(i => i.id === id);
    if (!item) return;
    const newCount = Math.max(1, (item.count || 1) + delta);
    try {
      await updateDoc(doc(db, 'items', id), { count: newCount });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `items/${id}`);
    }
  };

  const matchedCount = mergedItems.filter(i => i.status === 'matched').length;
  const totalQuantity = mergedItems.filter(i => i.status === 'matched').reduce((acc, item) => acc + (item.count || 1), 0);
  const totalEst = mergedItems.reduce((acc, item) => acc + (item.matchedProduct?.price || 0) * (item.count || 1), 0) / 100;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      <AnimatePresence>
        {aiError && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="fixed top-20 right-6 z-[200] max-w-sm w-full"
          >
            <div className="bg-slate-800 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-4 border border-slate-700/50 backdrop-blur-md">
              <div className="w-10 h-10 rounded-xl bg-slate-700 flex items-center justify-center shrink-0">
                <AlertCircle className="w-6 h-6 text-slate-300" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-bold">AI Service Notice</div>
                <div className="text-xs text-slate-300 leading-tight">{aiError}</div>
              </div>
              <button 
                onClick={() => setAiError(null)} 
                className="p-2 hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Top Navigation */}
      <nav className="h-16 lg:h-20 bg-white border-b border-slate-200 px-4 lg:px-8 flex items-center justify-between sticky top-0 z-[100] backdrop-blur-sm bg-white/90">
        <div className="flex items-center gap-2 lg:gap-3">
          <div className="w-8 h-8 lg:w-10 lg:h-10 bg-rose-600 rounded-xl flex items-center justify-center text-white font-bold shadow-lg shadow-rose-200">
            <ShoppingBasket className="w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-base lg:text-lg font-bold tracking-tight leading-tight">Matchie</span>
            <span className="hidden sm:inline text-[9px] font-bold text-rose-500 uppercase tracking-widest -mt-0.5">Picnic Helper</span>
          </div>
        </div>
        
        <div className="flex items-center gap-2 lg:gap-6">
          {picnicToken ? (
            <div className="flex items-center justify-center w-8 h-8" title="Connected to Picnic">
              <div className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.6)]"></div>
            </div>
          ) : (
            <div className="flex items-center justify-center w-8 h-8" title="Disconnected">
              <div className="w-2.5 h-2.5 bg-rose-500 rounded-full shadow-[0_0_10px_rgba(244,63,94,0.6)]"></div>
            </div>
          )}
          
          <div className="flex items-center gap-1 lg:gap-4 border-l border-slate-200 pl-2 lg:pl-6">
            {currentUserRole === 'admin' && (
              <button 
                onClick={() => setShowUserManagement(true)} 
                className="p-2.5 hover:bg-slate-100 rounded-xl transition-all cursor-pointer text-slate-500 hover:text-rose-600"
                title="Family Access"
              >
                <Shield className="w-5 h-5 sm:w-5 sm:h-5" />
              </button>
            )}
            {currentUserRole === 'admin' && (
              <button 
                onClick={() => setShowSettings(true)} 
                className="p-2.5 hover:bg-slate-100 rounded-xl transition-all cursor-pointer text-slate-500 hover:text-rose-600" 
                title="Cloud Connection"
              >
                <Settings className="w-5 h-5 sm:w-5 sm:h-5" />
              </button>
            )}
            <div className="flex items-center gap-2">
              <div className="hidden lg:flex flex-col items-end mr-1 text-right">
                <div className="text-[11px] font-bold text-slate-800 leading-tight">{user?.displayName || user?.email?.split('@')[0]}</div>
                <div className="text-[9px] text-slate-400 font-medium uppercase tracking-wider">{currentUserRole}</div>
              </div>
              <button onClick={() => signOut(auth)} className="p-2.5 hover:bg-rose-50 rounded-xl transition-all cursor-pointer text-slate-500 hover:text-rose-600" title="Sign Out">
                <LogOut className="w-5 h-5 sm:w-5 sm:h-5" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Workspace */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 p-4 lg:p-8 max-w-[1440px] mx-auto w-full pb-32 lg:pb-8 h-full overflow-y-auto lg:overflow-hidden">
        {/* Left: Shared List Column */}
        <section className="order-1 lg:col-span-4 flex flex-col gap-4">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-3.5 h-3.5 text-rose-500" />
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Shared List</h2>
            </div>
            <span className="text-[10px] bg-white border border-slate-200 text-slate-600 px-2.5 py-1 rounded-full font-bold shadow-sm">{items.length} Items</span>
          </div>

          <form onSubmit={addItem} className="relative group">
            <input 
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder="Add item (e.g. Milk)"
              className="w-full pl-4 pr-14 py-4 lg:py-3.5 bg-white border border-slate-200 rounded-2xl shadow-sm focus:ring-2 focus:ring-rose-500 focus:border-transparent outline-none transition-all placeholder:text-slate-400 text-base"
            />
            <button type="submit" className="absolute right-2 top-2 bottom-2 px-3 bg-rose-600 rounded-xl text-white hover:bg-rose-700 transition-all cursor-pointer shadow-md shadow-rose-200 active:scale-95">
              <Plus className="w-5 h-5" />
            </button>
          </form>

          <div className="bg-white lg:bg-slate-100/30 rounded-3xl lg:border border-slate-200 shadow-sm flex-1 overflow-hidden flex flex-col min-h-[250px] lg:min-h-0">
            <div className="flex-1 overflow-y-auto p-2 lg:p-4 space-y-2 custom-scrollbar">
              <AnimatePresence mode="popLayout">
                {items.length > 0 ? items.map((item) => (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    onClick={() => openMatcher(item)}
                    className={cn(
                      "group p-3 lg:p-3.5 rounded-2xl border transition-all cursor-pointer",
                      item.status === 'matched' 
                        ? "bg-slate-50 border-slate-200 shadow-sm" 
                        : "bg-white border-transparent hover:border-slate-200 shadow-sm lg:shadow-none hover:shadow-md"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={cn(
                          "w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all",
                          item.status === 'matched' 
                            ? "bg-rose-600 border-rose-600 shadow-sm" 
                            : "border-slate-200 group-hover:border-rose-300"
                        )}>
                          {item.status === 'matched' && <Check className="w-3.5 h-3.5 text-white" />}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className={cn(
                            "font-bold text-sm truncate", 
                            item.status === 'matched' ? "text-slate-500 line-through decoration-slate-300" : "text-slate-800"
                          )}>
                            {item.originalInput || `${item.count > 1 ? `${item.count} ` : ''}${toTitleCase(item.name)}`}
                          </span>
                          {item.addedByName && (
                            <span className="text-[9px] text-slate-400 font-medium truncate">
                              Added by {item.addedByName.split(' ')[0]}
                            </span>
                          )}
                        </div>
                      </div>
                      <button 
                        onClick={(e) => { e.stopPropagation(); removeItem(item.id); }}
                        className="p-2 text-slate-300 hover:text-rose-600 transition-all active:scale-90 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                )) : (
                  <div className="flex flex-col items-center justify-center h-full py-12 text-slate-300">
                    <div className="w-16 h-16 rounded-3xl bg-slate-50 flex items-center justify-center mb-4 border border-slate-100">
                      <ShoppingBasket className="w-8 h-8 opacity-20" />
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em]">List is empty</p>
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </section>

        {/* Right: Intelligence Center / Memory Manager */}
        <section className="order-2 lg:col-span-8 flex flex-col gap-4">

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-1.5 lg:gap-4 overflow-x-auto pb-2 sm:pb-0 scrollbar-none ring-1 ring-slate-200 lg:ring-0 p-1 lg:p-0 rounded-2xl bg-white lg:bg-transparent">
              <button 
                onClick={() => setView('list')}
                className={cn(
                  "flex-1 sm:flex-none whitespace-nowrap px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer",
                  view === 'list' 
                    ? "bg-rose-600 text-white shadow-md shadow-rose-100" 
                    : "text-slate-400 hover:bg-slate-100"
                )}
              >
                Matching
              </button>
              <button 
                onClick={() => setView('memory')}
                className={cn(
                  "flex-1 sm:flex-none whitespace-nowrap px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer",
                  view === 'memory' 
                    ? "bg-amber-500 text-white shadow-md shadow-amber-100" 
                    : "text-slate-400 hover:bg-slate-100"
                )}
              >
                Memory
              </button>
              <button 
                onClick={() => setView('favourites')}
                className={cn(
                  "flex-1 sm:flex-none whitespace-nowrap px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer",
                  view === 'favourites' 
                    ? "bg-purple-600 text-white shadow-md shadow-purple-100" 
                    : "text-slate-400 hover:bg-slate-100"
                )}
              >
                Favourites
              </button>
            </div>
            
            {view === 'list' && Object.values(matchingStatus).some(status => status) && (
              <div className="flex items-center gap-3 bg-slate-800 text-white px-4 py-2 rounded-2xl shadow-lg animate-in slide-in-from-top-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-rose-400" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">AI Scanning List...</span>
                </div>
              </div>
            )}
          </div>

          <AnimatePresence mode="wait">
            {view === 'list' ? (
              <motion.div 
                key="list-view"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col flex-1"
              >
                <div className="hidden lg:grid grid-cols-12 bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  <div className="col-span-3 p-4">Shopping List Item</div>
                  <div className="col-span-9 p-4 border-l border-slate-200">Picnic Favourites Match</div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {mergedItems.map((item) => (
                    <div 
                      key={item.id} 
                      onClick={() => openMatcher(item)}
                      className="flex flex-col lg:grid lg:grid-cols-12 border-b border-slate-100 hover:bg-slate-50/50 transition-all duration-300 group relative cursor-pointer"
                    >
                      {/* Desktop indicator for learned items */}
                      <div className="hidden lg:block absolute left-0 top-0 bottom-0 w-1 transition-all group-hover:bg-rose-500/10" />
                      
                      <div className="lg:col-span-3 p-4 flex items-center font-bold bg-slate-50/50 lg:bg-transparent lg:border-r border-slate-100 min-w-0">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-[10px] font-black text-slate-400 shadow-sm shrink-0">
                            {item.count}x
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="text-slate-900 truncate text-sm lg:text-base tracking-tight leading-tight">
                              {item.name}
                            </span>

                          </div>
                        </div>
                      </div>
                      
                      <div className="lg:col-span-9 p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 min-h-[90px]">
                        {item.matchedProduct ? (
                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between w-full gap-4">
                            <div className="flex items-center gap-4 flex-1 min-w-0">
                              <div className="w-14 h-14 bg-white border border-slate-100 rounded-2xl flex items-center justify-center overflow-hidden shrink-0 shadow-sm transition-transform group-hover:scale-105">
                                {item.matchedProduct.image ? (
                                  <img src={item.matchedProduct.image} alt="" className="w-full h-full object-contain p-1.5" />
                                ) : (
                                  <ShoppingBasket className="w-6 h-6 text-slate-200" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-bold text-slate-800 line-clamp-1 group-hover:text-rose-600 transition-colors uppercase tracking-tight">{item.matchedProduct.name}</div>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                                  <div className="text-[11px] font-black text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded">€{(item.matchedProduct.price || 0) / 100}</div>
                                  <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest whitespace-nowrap">
                                    {item.matchedProduct.unit_quantity ? <span>{item.matchedProduct.unit_quantity} </span> : null}
                                    {item.matchedProduct.unit_name ? <span>({item.matchedProduct.unit_name}) </span> : null}
                                  </div>
                                  {(() => {
                                    const pref = preferences[(item.name || "").toLowerCase()];
                                    const prefId = typeof pref === 'object' ? pref?.id : pref;
                                    if (prefId === item.matchedProduct.id) {
                                      return <div className="flex items-center gap-1 text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tight ring-1 ring-amber-200">
                                        <Brain className="w-2.5 h-2.5" />
                                        <span>Learned</span>
                                      </div>;
                                    }
                                    return <div className="flex items-center gap-1 text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tight ring-1 ring-purple-200">
                                      <Sparkles className="w-2.5 h-2.5" />
                                      <span>AI</span>
                                    </div>;
                                  })()}
                                </div>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-3 justify-between sm:justify-end border-t sm:border-t-0 pt-4 sm:pt-0 border-slate-100">
                              <div className="flex items-center bg-slate-100 rounded-xl p-1 shadow-inner" onClick={(e) => e.stopPropagation()}>
                                <button 
                                  onClick={() => updateCount(item.id, -1)}
                                  className="w-8 h-8 flex items-center justify-center hover:bg-white rounded-lg transition-all text-slate-500 hover:text-rose-600 cursor-pointer"
                                >
                                  <Minus className="w-4 h-4" />
                                </button>
                                <span className="w-10 text-center text-sm font-black text-slate-900">{item.count}</span>
                                <button 
                                  onClick={() => updateCount(item.id, 1)}
                                  className="w-8 h-8 flex items-center justify-center hover:bg-white rounded-lg transition-all text-slate-500 hover:text-rose-600 cursor-pointer"
                                >
                                  <Plus className="w-4 h-4" />
                                </button>
                              </div>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                openMatcher(item);
              }}
              className="h-10 px-4 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-all shadow-sm active:scale-95 whitespace-nowrap lg:opacity-0 lg:group-hover:opacity-100 cursor-pointer"
            >
              Change
            </button>
                            </div>
                          </div>
                        ) : item.candidates && item.candidates.length > 0 ? (
                           <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full animate-in fade-in zoom-in-95">
                             <div className="flex items-center gap-2 text-purple-700 bg-purple-50/50 px-3 py-2 rounded-xl border border-purple-100 flex-1">
                               <Sparkles className="w-4 h-4 shrink-0 text-purple-400" />
                               <span className="text-[10px] font-black uppercase tracking-widest">{item.candidates.length} Patterns Detected</span>
                             </div>
                             <button 
                               onClick={(e) => {
                                 e.stopPropagation();
                                 setCandidateSelectionItem(item);
                               }}
                               className="flex-[2] py-3.5 bg-purple-600 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-purple-700 hover:shadow-lg hover:shadow-purple-200 transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-[0.98]"
                             >
                               <Check className="w-3.5 h-3.5" />
                               Review Best Fit
                             </button>
                           </div>
                        ) : (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              openMatcher(item);
                            }}
                            className="w-full py-4 border-2 border-dashed border-slate-200 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 hover:border-rose-300 hover:text-rose-500 hover:bg-rose-50/30 transition-all cursor-pointer flex items-center justify-center gap-3"
                          >
                            <Search className="w-4 h-4" />
                            {/* @ts-ignore */}
                            {item.originalIds.some(id => matchingStatus[id]) ? "AI scanning catalogue..." : "Connect manual match"}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {items.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full py-24 px-8 text-center bg-slate-50/30 rounded-3xl m-4 border border-dashed border-slate-200">
                      <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-sm mb-4">
                        <ShoppingBasket className="w-8 h-8 text-slate-300" />
                      </div>
                      <h3 className="text-sm font-bold text-slate-600 uppercase tracking-widest mb-1 italic">Waiting for your first list items</h3>
                      <p className="text-xs text-slate-400 max-w-[240px]">Add items on the left to start matching them with your favourite Picnic products.</p>
                    </div>
                  )}
                </div>
              </motion.div>
            ) : view === 'memory' ? (
              <motion.div 
                key="memory-view"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex-1"
              >
                <MemoryManager 
                  preferences={preferences} 
                  onUpdateMemory={handleUpdateMemory}
                  onBatchUpdateMemory={handleBatchUpdateMemory}
                  onRunAiMatchMemory={handleRunAiMatchMemory}
                  onReviewCandidates={(term, candidates) => {
                    const fakeItem: ShoppingListItem = {
                      id: `temp-${term}`,
                      name: term,
                      count: 1,
                      status: 'unmatched',
                      candidates: candidates
                    } as any;
                    setCandidateSelectionItem(fakeItem);
                  }}
                  onSelectProduct={(term, currentTerms) => {
                    const fakeItem: ShoppingListItem = {
                      id: `temp-${term}`,
                      name: term,
                      originalTerms: currentTerms,
                      count: 1,
                      status: 'unmatched'
                    } as any;
                    setManualSearchItem(fakeItem);
                  }}
                  onSyncMemory={handleSyncMemory}
                  syncing={refreshing}
                  favourites={favourites}
                  picnicToken={picnicToken}
                />
              </motion.div>
            ) : (
              <motion.div 
                key="favourites-view"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex-1"
              >
                <FavouritesList 
                  favourites={favourites} 
                  onRefresh={loadPicnicData}
                  refreshing={refreshing}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </main>

      {/* Bottom Action Footer */}
      <footer className="bg-white border-t border-slate-200 px-4 lg:px-8 py-4 pb-8 lg:pb-4 lg:h-24 flex flex-col lg:flex-row items-center justify-between gap-4 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] fixed lg:sticky bottom-0 left-0 right-0 z-[90]">
        <div className="flex items-center justify-between w-full lg:w-auto lg:gap-12">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-1">Estimated Total</span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-black tracking-tight text-slate-900 leading-none">€{totalEst.toFixed(2)}</span>
              <span className="text-[10px] font-bold text-slate-400 uppercase">Matchie Est.</span>
            </div>
          </div>
          <div className="lg:hidden">
            <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 rounded-xl border border-slate-100">
              <ShoppingBasket className="w-4 h-4 text-rose-500" />
              <span className="text-xs font-bold text-slate-700">{totalQuantity}</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-3 w-full lg:w-auto">
          <button 
            onClick={sendToPicnic}
            disabled={matchedCount === 0 || !picnicToken}
            className={cn(
              "flex-1 lg:flex-none px-6 lg:px-12 py-4 bg-rose-600 text-white rounded-2xl font-bold shadow-xl shadow-rose-200 flex items-center justify-center gap-3 hover:bg-rose-700 transition-all active:scale-[0.98] disabled:opacity-50 disabled:grayscale whitespace-nowrap group",
              matchedCount > 0 && picnicToken ? "cursor-pointer" : "cursor-not-allowed"
            )}
          >
            <span className="text-sm tracking-tight">Sync to Picnic Basket</span>
            <div className="w-6 h-6 rounded-lg bg-white/20 flex items-center justify-center group-hover:translate-x-1 transition-transform">
              <ChevronRight className="w-4 h-4" />
            </div>
          </button>
        </div>
      </footer>


      {/* Modals */}
      {showSettings && (
        <PicnicSettings 
          picnicToken={picnicToken}
          picnicEmail={picnicEmail}
          onClose={() => setShowSettings(false)}
          onConnected={async (token, userEmail) => {
            setPicnicToken(token);
            setPicnicEmail(userEmail);
            try {
              // Write to shared config so all users get the token
              await setDoc(doc(db, 'config', 'picnic'), { 
                picnicToken: token,
                email: userEmail
              }, { merge: true });
            } catch (e) {
              console.error("Failed to share Picnic connection", e);
            }
          }}
          onDisconnect={async () => {
            setPicnicToken(null);
            setPicnicEmail(null);
            localStorage.removeItem('picnicEmail');
            try {
              await deleteDoc(doc(db, 'config', 'picnic'));
            } catch (e) {
              // Ignore
            }
            setFavourites([]);
          }}
        />
      )}

      {showUserManagement && (
        <UserManagement 
          currentUserEmail={user?.email || ''} 
          onClose={() => setShowUserManagement(false)} 
        />
      )}

      {manualSearchItem && (
        <ManualSearchModal 
          item={manualSearchItem}
          token={picnicToken || ''}
          onClose={() => setManualSearchItem(null)}
          onSelect={(product) => {
            updateMatch(manualSearchItem, product);
            setManualSearchItem(null);
          }}
        />
      )}
      {candidateSelectionItem && (
        <CandidateSelectionModal 
          item={candidateSelectionItem}
          onClose={() => setCandidateSelectionItem(null)}
          onSelect={(product) => {
            updateMatch(candidateSelectionItem, product);
            setCandidateSelectionItem(null);
          }}
          onManualSearch={() => {
            setManualSearchItem(candidateSelectionItem);
            setCandidateSelectionItem(null);
          }}
        />
      )}
    </div>
  );

  function openMatcher(item: ShoppingListItem) {
    if (!picnicToken) {
      if (currentUserRole === 'admin') {
        setShowSettings(true);
      } else {
        alert("The Picnic app is not connected. Please ask the admin to connect it.");
      }
      return;
    }
    
    // Prioritize candidate selection if candidates exist
    if (item.candidates && item.candidates.length > 0 && !item.matchedProduct) {
      setCandidateSelectionItem(item);
    } else {
      setManualSearchItem(item);
    }
  }
}

function CandidateSelectionModal({ item, onClose, onSelect, onManualSearch }: { 
  item: ShoppingListItem, 
  onClose: () => void, 
  onSelect: (product: PicnicProduct) => void,
  onManualSearch: () => void
}) {
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
      />
      <motion.div 
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className="relative w-full max-w-xl bg-slate-50 rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
      >
        <div className="p-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center text-purple-600">
                <Sparkles className="w-5 h-5" />
              </div>
              <h2 className="text-xl font-bold text-slate-800 tracking-tight">Select Best Fit</h2>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-400 cursor-pointer">
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-sm text-slate-500">
            AI found {item.candidates?.length} potential favourites for <span className="font-bold text-slate-800">"{item.name}"</span>. Choose the one you want to link.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-8 pt-0 custom-scrollbar">
          <div className="grid gap-3">
            {Array.isArray(item.candidates) && Array.from(new Map((item.candidates as PicnicProduct[]).map(p => [p.id, p])).values()).map((product) => (
              <button 
                key={product.id}
                onClick={() => onSelect(product)}
                className="flex items-center gap-4 p-4 bg-white border border-slate-200 rounded-2xl hover:border-purple-400 hover:shadow-md transition-all text-left group cursor-pointer"
              >
                <div className="w-16 h-16 bg-slate-50 rounded-xl flex items-center justify-center overflow-hidden border border-slate-100 shrink-0">
                  {product.image ? (
                    <img src={product.image} alt="" className="w-full h-full object-contain p-1" />
                  ) : (
                    <ShoppingBasket className="w-8 h-8 text-slate-200" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-slate-800 group-hover:text-purple-700 transition-colors line-clamp-2">{product.name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs font-mono font-bold text-slate-900 text-[11px]">€{(product.price || 0) / 100}</span>
                    <span className="text-[10px] text-slate-400 font-medium">
                      {product.unit_quantity} {product.unit_name ? `(${product.unit_name})` : ''}
                    </span>
                  </div>
                </div>
                <div className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center group-hover:border-purple-400 group-hover:bg-purple-50 transition-all">
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-purple-500" />
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="p-6 bg-white border-t border-slate-100 flex items-center justify-center">
          <button 
            onClick={onManualSearch}
            className="text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-purple-600 transition-colors cursor-pointer"
          >
            I'll search manually instead
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function ManualSearchModal({ item, token, onClose, onSelect }: { 
  item: ShoppingListItem, 
  token: string, 
  onClose: () => void, 
  onSelect: (product: PicnicProduct) => void 
}) {
  const [query, setQuery] = useState(item.name);
  const [results, setResults] = useState<PicnicProduct[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    handleSearch();
  }, []);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const data = await picnicApi.search(token, query);
      setResults(data);
    } catch (e) {
      console.error("Search failed", e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
      />
      <motion.div 
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        className="relative w-full max-w-xl bg-white rounded-[32px] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden border border-slate-100"
      >
        <div className="p-8 border-b border-slate-100">
          <div className="flex justify-between items-start mb-6">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600">
                <ShoppingBasket className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-800">Search Products</h2>
                <p className="text-slate-500 text-sm">Find the perfect match for "<span className="text-amber-600 font-semibold">{item.name}</span>"</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors cursor-pointer">
              <Plus className="w-6 h-6 rotate-45 text-slate-400" />
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input 
              type="text" 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search Picnic catalogue..."
              className="w-full pl-12 pr-4 py-4 bg-slate-100 border-none rounded-2xl focus:ring-2 focus:ring-amber-500 outline-none transition-all font-medium"
              autoFocus
            />
            {loading && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 animate-spin text-amber-600" />}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-2">
          {Array.isArray(results) && results.length > 0 ? (
            Array.from(new Map((results as PicnicProduct[]).map(p => [p.id, p])).values()).map((product) => (
              <button 
                key={product.id}
                onClick={() => onSelect(product)}
                className="w-full flex items-center gap-4 p-4 rounded-3xl hover:bg-amber-50 transition-all group text-left border border-transparent hover:border-amber-100 cursor-pointer"
              >
                <div className="w-16 h-16 bg-white border border-slate-100 rounded-2xl flex items-center justify-center flex-shrink-0">
                  {product.image ? (
                    <img src={product.image} alt="" className="w-full h-full object-contain p-2" referrerPolicy="no-referrer" />
                  ) : (
                    <ShoppingBasket className="w-8 h-8 text-slate-200" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="font-bold text-slate-900 group-hover:text-amber-600 transition-colors leading-tight">{product.name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="text-[11px] font-mono font-bold text-slate-800">€{(product.price || 0) / 100}</div>
                    <div className="text-[11px] text-slate-400 font-medium">
                      {product.unit_quantity ? <span>{product.unit_quantity} </span> : null}
                      {product.unit_name ? <span>({product.unit_name})</span> : null}
                    </div>
                  </div>
                  {product.price_per_unit_text && (
                    <div className="text-[10px] text-slate-400 italic mt-0.5">{product.price_per_unit_text}</div>
                  )}
                </div>
                <div className="w-10 h-10 rounded-full bg-slate-100 group-hover:bg-amber-600 flex items-center justify-center transition-all">
                  <Check className="w-5 h-5 text-slate-300 group-hover:text-white" />
                </div>
              </button>
            ))
          ) : !loading && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-300">
              <Search className="w-12 h-12 mb-4 opacity-20" />
              <p className="text-sm font-bold uppercase tracking-widest">No results found</p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function PicnicSettings({ picnicToken, picnicEmail, onClose, onConnected, onDisconnect }: { 
  picnicToken: string | null,
  picnicEmail: string | null,
  onClose: () => void, 
  onConnected: (token: string, email: string) => void,
  onDisconnect: () => void
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [step, setStep] = useState<'login' | 'mfa'>('login');
  const [tempToken, setTempToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await picnicApi.login(email, password);
      if (data.secondFactorRequired) {
        setTempToken(data.token);
        setStep('mfa');
      } else {
        onConnected(data.token, email);
        onClose();
      }
    } catch (e: any) {
      const msg = e.response?.data?.message || e.response?.data?.error || "Picnic login failed. Check credentials.";
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setLoading(false);
    }
  };

  const requestMfa = async () => {
    setLoading(true);
    setError('');
    try {
      await picnicApi.requestMfaCode(tempToken);
    } catch (e: any) {
      setError("Failed to request MFA code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const submitMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await picnicApi.verifyMfaCode(tempToken, mfaCode);
      onConnected(data.token, email);
      onClose();
    } catch (e: any) {
      setError("Invalid 2FA code. Please check and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-xl bg-slate-50 rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
      >
        <div className="p-8 relative">
          <button 
            onClick={onClose}
            className="absolute right-6 top-6 p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-600 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <div className="bg-rose-100 p-2 rounded-xl text-rose-600">
              <Settings className="w-6 h-6" />
            </div>
            Shop Connection
          </h2>
          <p className="text-sm text-slate-500 mt-2">
            {picnicToken 
              ? 'Your Picnic account is currently linked and shared with your family.'
              : (step === 'login' 
                ? 'Securely link your Picnic account to enable basket syncing.'
                : 'Picnic requires two-factor authentication for this account.')}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-8 pt-0">
          {picnicToken ? (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex items-center gap-4">
                <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center text-green-600">
                  <Check className="w-6 h-6" />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-900">Connected to Picnic</div>
                  {picnicEmail && (
                    <div className="text-xs text-slate-500 font-medium">{picnicEmail}</div>
                  )}
                  <div className="text-[10px] text-green-600 font-bold uppercase tracking-wider mt-0.5">Authentication Active</div>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <button 
                  onClick={onDisconnect}
                  className="w-full py-4 px-6 bg-white border border-rose-200 text-rose-600 font-bold text-sm rounded-2xl hover:bg-rose-50 transition-all flex items-center justify-center gap-3 cursor-pointer"
                >
                  <LogOut className="w-5 h-5" />
                  Disconnect Shop
                </button>
              </div>
            </div>
          ) : step === 'login' ? (
            <form onSubmit={submitLogin} className="space-y-5">
              <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">Email address</label>
                  <input 
                    type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 outline-none transition-all placeholder:text-slate-300 text-sm"
                    placeholder="your@picnic-email.com" required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">Password</label>
                  <input 
                    type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 outline-none transition-all text-sm"
                    required
                  />
                </div>
              </div>

              {error && (
                <div className="bg-rose-50 text-rose-600 text-xs font-bold p-4 rounded-xl border border-rose-100 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" /> {error}
                </div>
              )}

              <button 
                type="submit" disabled={loading}
                className={cn(
                  "w-full py-4 bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm rounded-2xl transition-all shadow-lg shadow-rose-100 flex items-center justify-center disabled:opacity-50",
                  loading ? "cursor-not-allowed" : "cursor-pointer"
                )}
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Connect Account"}
              </button>
            </form>
          ) : (
            <form onSubmit={submitMfa} className="space-y-5">
              <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">2FA Verification Code</label>
                  <div className="flex gap-2">
                    <input 
                      type="text" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)}
                      className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 outline-none transition-all placeholder:text-slate-300 text-sm"
                      placeholder="Enter SMS code" required
                    />
                    <button 
                      type="button" 
                      onClick={requestMfa}
                      disabled={loading}
                      className={cn(
                        "px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-[10px] uppercase tracking-widest rounded-xl transition-all disabled:opacity-50",
                        loading ? "cursor-not-allowed" : "cursor-pointer"
                      )}
                    >
                      Resend
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-2 px-1">Check your SMS for the authentication code.</p>
                </div>
              </div>

              {error && (
                <div className="bg-rose-50 text-rose-600 text-xs font-bold p-4 rounded-xl border border-rose-100 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" /> {error}
                </div>
              )}

              <button 
                type="submit" disabled={loading || !mfaCode}
                className={cn(
                  "w-full py-4 bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm rounded-2xl transition-all shadow-lg shadow-rose-100 flex items-center justify-center disabled:opacity-50",
                  loading || !mfaCode ? "cursor-not-allowed" : "cursor-pointer"
                )}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify Identity"}
              </button>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}
