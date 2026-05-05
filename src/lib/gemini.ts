import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Global concurrency lock to prevent flooding the API
let isAiProcessing = false;
const aiQueue: (() => Promise<any>)[] = [];

async function processQueue() {
  if (isAiProcessing || aiQueue.length === 0) return;
  
  isAiProcessing = true;
  const task = aiQueue.shift();
  if (task) {
    try {
      await task();
    } finally {
      // Small pause between tasks to avoid rapid-fire requests
      setTimeout(() => {
        isAiProcessing = false;
        processQueue();
      }, 500); 
    }
  } else {
    isAiProcessing = false;
  }
}

function queueAiTask<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    aiQueue.push(async () => {
      try {
        const result = await task();
        resolve(result);
      } catch (e) {
        reject(e);
      }
    });
    processQueue();
  });
}

// Global delay function with jitter
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms + Math.random() * 500));

/**
 * Internal helper to run a promise with a timeout.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, timeoutErrorName: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutErrorName));
    }, ms);
    promise.then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function withRetry<T>(task: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let attempts = 0;
  const baseDelay = 2000;

  while (attempts < maxAttempts) {
    try {
      // Wrap the actual task in a 15-second timeout
      return await withTimeout(task(), 15000, "AI_SERVICE_TIMEOUT");
    } catch (error: any) {
      attempts++;
      
      const errorMessage = error?.message?.toLowerCase() || '';
      const status = error?.status || error?.code;
      
      const isRateLimit = errorMessage.includes('429') || status === 429 || errorMessage.includes('rate limit');
      const isQuota = errorMessage.includes('quota') || errorMessage.includes('resource_exhausted') || status === 'RESOURCE_EXHAUSTED' || errorMessage.includes('exceeded') || status === 403 || status === 'PERMISSION_DENIED';
      
      if ((isRateLimit || isQuota) && attempts < maxAttempts) {
        // Longer wait for quota issues
        const waitTime = isQuota ? 3000 * attempts : baseDelay * Math.pow(2, attempts);
        console.warn(`Gemini API limited (${isQuota ? 'Quota' : 'Rate Limit'}). Retrying in ${waitTime}ms... (Attempt ${attempts}/${maxAttempts})`);
        await delay(waitTime);
        continue;
      }
      
      if (isQuota) throw new Error("AI_SERVICE_QUOTA_EXCEEDED");
      if (isRateLimit) throw new Error("AI_SERVICE_RATE_LIMITED");
      if (error?.message === "AI_SERVICE_TIMEOUT") throw error;
      
      throw error;
    }
  }
  throw new Error('AI_SERVICE_UNAVAILABLE');
}

export interface PicnicProduct {
  id: string;
  name: string;
  image?: string;
  price?: number;
  unit_quantity?: string;
  unit_name?: string;
  price_per_unit_text?: string;
}

export interface MatchResult {
  product: PicnicProduct | null;
  candidates?: PicnicProduct[];
  confidence?: number;
}

export async function autoMatchMultipleProducts(
  itemNames: string[],
  favorites: PicnicProduct[],
  pastMatches: Record<string, any> = {}
): Promise<Record<string, MatchResult>> {
  const results: Record<string, MatchResult> = {};
  const itemsToMatch: string[] = [];

  for (const itemName of itemNames) {
    const normalizedItemName = (itemName || "").toLowerCase();
    if (pastMatches[normalizedItemName]) {
      const learned = pastMatches[normalizedItemName];
      if (typeof learned === 'object') {
        if ('product' in learned && learned.product) {
          results[itemName] = { product: learned.product as PicnicProduct };
          continue;
        } else if (learned.id) {
          results[itemName] = { product: learned as PicnicProduct };
          continue;
        } else if (learned.candidates && learned.candidates.length > 0) {
          results[itemName] = { product: null, candidates: learned.candidates as PicnicProduct[] };
          continue;
        }
      } else if (typeof learned === 'string') {
        const found = favorites.find(f => f.id === learned);
        if (found) {
          results[itemName] = { product: found };
          continue;
        }
      }
    }
    itemsToMatch.push(itemName);
    results[itemName] = { product: null }; // Default to null
  }

  if (itemsToMatch.length === 0) return results;
  
  return queueAiTask(async () => {
    return withRetry(async () => {
      const searchTerms = itemsToMatch.flatMap(it => 
        (it || "").toLowerCase().split(/\s+/).filter(w => w.length > 2)
      );
      
      let candidates = favorites;
      if (favorites.length > 50 && searchTerms.length > 0) {
        candidates = favorites.filter(f => {
          const nameLower = (f.name || "").toLowerCase();
          return searchTerms.some(term => nameLower.includes(term));
        });
        
        if (candidates.length < 20) {
          candidates = favorites.slice(0, 50);
        }
      }
      
      candidates = candidates.slice(0, 80);

      const prompt = `
      Task: Match a shopping list to a set of "Favourite Products".
      
      A user has a list of items they want to buy. You must find the best fit for each item in the "Picnic Favourites" list provided below.
      
      Items to match:
      ${itemsToMatch.map((t, i) => `[${i}] ${t}`).join('\n')}
 
      Picnic Favourites (Available match candidates):
      ${candidates.map(f => `ID: ${f.id} - Name: ${f.name}`).join('\n')}
 
      Instruction for sophisticated matching:
      1. Semantic Understanding: Map generic terms to specific favourites.
      2. Multi-language: Handle terms in German, Dutch, or English.
      3. Brands & Substitutes: If exact brand is missing, pick closest from favourites.
      4. Sizing: Ignore minor size differences.
      5. Confidence & Candidates: 
         - If you found EXACTLY ONE very strong match (>95%), return its ID in matchId.
         - If there are MULTIPLE potential matches that could fit or any ambiguity, return them ALL in candidatesIds (up to 5) and set matchId to "NULL".
         - If no match found, return matchId as "NULL".
      6. Return the matches in an array corresponding exactly to the order of "Items to match".
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              matches: {
                type: Type.ARRAY,
                description: "Array of matches corresponding to the input items in the same order.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    matchId: { type: Type.STRING, description: "The ID of the best matched product, or NULL." },
                    candidatesIds: { 
                      type: Type.ARRAY, 
                      items: { type: Type.STRING },
                      description: "List of multiple candidate IDs if the user should choose."
                    },
                    confidence: { type: Type.NUMBER, description: "Confidence score from 0 to 1" }
                  },
                  required: ["matchId", "confidence"]
                }
              }
            },
            required: ["matches"]
          },
        },
      });

      const resultData = JSON.parse(response.text || "{}");
      if (resultData.matches && Array.isArray(resultData.matches)) {
        itemsToMatch.forEach((itemName, index) => {
          const matchResult = resultData.matches[index];
          if (matchResult) {
            const product = matchResult.matchId && matchResult.matchId !== "NULL" 
              ? favorites.find(f => f.id === matchResult.matchId) || null 
              : null;
            
            const candidateIds = matchResult.candidatesIds || [];
            const resultCandidates = candidateIds
              .map((id: string) => favorites.find(f => f.id === id))
              .filter((p: PicnicProduct | undefined): p is PicnicProduct => p !== undefined);

            const resultObj: MatchResult = {
              product,
              confidence: matchResult.confidence
            };
            
            if (resultCandidates.length > 0) {
              resultObj.candidates = resultCandidates;
              if (resultCandidates.length > 1) {
                resultObj.product = null;
              }
            }

            results[itemName] = resultObj;
          }
        });
      }
      return results;
    });
  });
}

export async function autoMatchProduct(
  itemName: string,
  favorites: PicnicProduct[],
  pastMatches: Record<string, any> = {}
): Promise<MatchResult> {
  const normalizedItemName = (itemName || "").toLowerCase();

  if (pastMatches[normalizedItemName]) {
    const learned = pastMatches[normalizedItemName];
    if (typeof learned === 'object') {
      if ('product' in learned && learned.product) {
        return { product: learned.product as PicnicProduct };
      } else if (learned.id) {
        return { product: learned as PicnicProduct };
      } else if (learned.candidates && learned.candidates.length > 0) {
        return { product: null, candidates: learned.candidates as PicnicProduct[] };
      }
    } else if (typeof learned === 'string') {
      return { product: favorites.find(f => f.id === learned) || null };
    }
  }

  let result: MatchResult = { product: null };

  return queueAiTask(async () => {
    return withRetry(async () => {
      const searchWords = normalizedItemName.split(/\s+/).filter(w => w.length > 2);
      let candidates = favorites;
      
      if (favorites.length > 40 && searchWords.length > 0) {
        candidates = favorites.filter(f => {
          const nameLower = (f.name || "").toLowerCase();
          return searchWords.some(word => nameLower.includes(word));
        });
        
        if (candidates.length < 10) {
          candidates = favorites.slice(0, 40);
        }
      }
      candidates = candidates.slice(0, 60);

      const prompt = `
      Task: Match a shopping list item: "${itemName}"
      Identify the most likely product from this list of "Picnic Favourites":
      ${candidates.map(f => `ID: ${f.id} - Name: ${f.name}`).join('\n')}

      Instruction:
      - If EXACTLY ONE very strong match (>95%), return its ID in matchId.
      - If MULTIPLE candidates could fit or there is ambiguity, return them all in candidatesIds and set matchId to "NULL".
      - Otherwise set matchId to "NULL".
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              matchId: { type: Type.STRING, description: "The ID of the best matched product, or NULL." },
              candidatesIds: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING },
                description: "List of multiple candidate IDs if the user should choose."
              },
              confidence: { type: Type.NUMBER, description: "Confidence score from 0 to 1" }
            },
            required: ["matchId", "confidence"]
          },
        },
      });

      const apiResult = JSON.parse(response.text || "{}");
      
      const product = apiResult.matchId && apiResult.matchId !== "NULL" 
        ? favorites.find((f: PicnicProduct) => f.id === apiResult.matchId) || null 
        : null;
      
      const candidateIds = apiResult.candidatesIds || [];
      const candidateProducts = candidateIds
          .map((id: string) => favorites.find((f: PicnicProduct) => f.id === id))
          .filter((p: PicnicProduct | undefined): p is PicnicProduct => p !== undefined);

      const finalResult: MatchResult = {
        product,
        confidence: apiResult.confidence
      };

      if (candidateProducts.length > 0) {
        finalResult.candidates = candidateProducts;
        if (candidateProducts.length > 1) {
          finalResult.product = null;
        }
      }

      return finalResult;
    });
  });
}

