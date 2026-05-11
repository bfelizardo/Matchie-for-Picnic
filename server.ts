import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// @ts-ignore - picnic-api uses module.exports and might cause type issues in some ESM setups
import PicnicClient from "picnic-api";
import { JSONPath } from 'jsonpath-plus';

const app = express();
const PORT = 3000;

app.use(express.json());

// Helper to get a Picnic client with the user's token
const getPicnicClient = (token?: string, country?: string) => {
  return new PicnicClient({
    countryCode: (country || "DE") as any,
    apiVersion: "17", // Using 17 as it seems to be the latest version the user was trying
    authKey: token || undefined,
  });
};

// Picnic Login
app.post("/api/picnic/login", async (req, res) => {
  const { email, password } = req.body;
  const country = req.headers["x-picnic-country"] as string;

  if (!email || !password) {
    return res.status(400).json({ error: { message: "Email and password are required" } });
  }

  const picnic = getPicnicClient(undefined, country);
  try {
    const loginResult = await picnic.auth.login(email.trim(), password);
    
    // If 2FA is required, we return the info and the intermediate token
    if (loginResult.second_factor_authentication_required) {
      return res.json({ 
        secondFactorRequired: true, 
        token: loginResult.authKey 
      });
    }

    const userDetails = await picnic.user.getUserDetails();
    res.json({ token: loginResult.authKey, user: userDetails });
  } catch (error: any) {
    console.error("Picnic Login Error:", error.message);
    res.status(401).json({ error: { message: error.message } });
  }
});

// Request MFA Code
app.post("/api/picnic/mfa/request", async (req, res) => {
  const token = req.headers["x-picnic-auth"] as string;
  const country = req.headers["x-picnic-country"] as string;
  const picnic = getPicnicClient(token, country);
  try {
    await picnic.auth.generate2FACode("SMS");
    res.json({ success: true });
  } catch (error: any) {
    console.error("Picnic MFA Request Error:", error.message);
    res.status(500).json({ error: { message: error.message } });
  }
});

// Verify MFA Code
app.post("/api/picnic/mfa/verify", async (req, res) => {
  const { code } = req.body;
  const token = req.headers["x-picnic-auth"] as string;
  const country = req.headers["x-picnic-country"] as string;
  const picnic = getPicnicClient(token, country);
  try {
    const result = await picnic.auth.verify2FACode(code);
    // After verification, we need to refresh the client to get the new user details
    const updatedPicnic = getPicnicClient(result.authKey, country);
    const userDetails = await updatedPicnic.user.getUserDetails();
    
    res.json({ token: result.authKey, user: userDetails });
  } catch (error: any) {
    console.error("Picnic MFA Verify Error:", error.message);
    res.status(400).json({ error: { message: error.message } });
  }
});

// Get favorites
app.get("/api/picnic/favorites", async (req, res) => {
  const token = req.headers["x-picnic-auth"] as string;
  const country = req.headers["x-picnic-country"] as string;
  const picnic = getPicnicClient(token, country);
  try {
    // Try to find valid page IDs from bootstrap first
    let dynamicEndpoints: string[] = [];
    try {
      const bootstrap = await picnic.sendRequest("GET", "/bootstrap");
      const tabLinks = JSONPath({ path: "$..link", json: bootstrap as object }) as any as string[];
      tabLinks.forEach(link => {
        if (link.startsWith("picnic://pages/")) {
          dynamicEndpoints.push(link.replace("picnic://", "/"));
        }
      });
    } catch (e) {
      console.warn("Bootstrap check failed, falling back to static list");
    }

    // Try multiple potential favorites/purchases endpoints for version 17
    const preferredEndpoints = [
      "/pages/purchases",
      "/pages/frequently-purchased",
      "/pages/frequently_purchased",
      "/pages/favorieten",
      "/pages/favorites",
      "/pages/meine-favoriten",
      "/pages/favoris",
    ];

    const fallbackEndpoints = [
      "/pages/purchases-page-root",
      "/pages/favorieten-page-root",
      "/pages/favorites-page-root",
      "/pages/meine-favoriten-page-root",
      "/pages/shopping-list",
      "/pages/shopping-list-page-root",
      "/pages/purchase-history",
      "/pages/home_page_root",
      "/user/favorites",
      "/favorites"
    ];

    const endpoints = [
      ...preferredEndpoints,
      ...dynamicEndpoints.filter(e => !preferredEndpoints.includes(e) && !fallbackEndpoints.includes(e)),
      ...fallbackEndpoints
    ];

    let favoritesPage = null;
    let lastError = null;
    let successEndpoint = null;

    for (const endpoint of endpoints) {
      try {
        console.log(`Trying favorites endpoint: ${endpoint}`);
        const page = await picnic.sendRequest("GET", endpoint, null, true);
        
        if (page) {
          // Extract products safely from the response
          const sellingUnits = JSONPath({ path: "$..sellingUnit", json: page as object }) as any[];
          const products = JSONPath({ path: "$..product", json: page as object }) as any[];
          const combined = [...(sellingUnits || []), ...(products || [])].filter(i => i && i.id);
          
          if (combined && combined.length > 0) {
            console.log(`Successfully fetched from: ${endpoint} (Found ${combined.length} items)`);
            favoritesPage = page;
            successEndpoint = endpoint;
            break;
          }
          
          // If we successfully fetched a page but it's empty, we remember it as a potential "real" endpoint
          // If it's a strongly named favorites endpoint, we stop here to avoid falling back to irrelevant pages
          if (endpoint.includes("purchases") || endpoint.includes("favori") || endpoint.includes("favorite")) {
            console.log(`Found valid but empty favorites endpoint: ${endpoint}`);
            successEndpoint = endpoint;
            break; 
          }
        }
      } catch (e: any) {
        lastError = e;
        // Only log non-404 errors as warnings
        if (!e.message?.includes("404") && !e.message?.includes("not found")) {
          console.warn(`Error fetching from ${endpoint}: ${e.message}`);
        }
      }
    }

    if (!favoritesPage && !successEndpoint) {
      throw lastError || new Error("Could not find any valid favorites endpoint");
    }

    // Extract products safely from the response (or an empty list if we just found an empty endpoint)
    let rawItems: any[] = [];
    if (favoritesPage) {
      const sellingUnits = JSONPath({ path: "$..sellingUnit", json: favoritesPage as object }) as any[];
      const products = JSONPath({ path: "$..product", json: favoritesPage as object }) as any[];
      rawItems = [...(sellingUnits || []), ...(products || [])].filter(i => i && i.id);
    }
    
    // Map to a common format
    const seenIds = new Set();
    const mapped: any[] = [];
    
    // Determine base URL for images from picnic client
    const alternateRoute = picnic.url.split("/api/")[0];

    rawItems.forEach((item: any) => {
      if (item && item.id && !seenIds.has(item.id)) {
        seenIds.add(item.id);
        mapped.push({
          id: item.id,
          name: item.name,
          image: item.image_id ? `${alternateRoute}/static/images/${item.image_id}/medium.png` : undefined,
          price: item.display_price || (item.price ? (item.price / 100).toFixed(2) : "0.00"),
          unit_quantity: item.unit_quantity,
          unit_name: item.unit_name,
          price_per_unit_text: item.unit_price_text
        });
      }
    });

    res.json(mapped);
  } catch (error: any) {
    console.error("Picnic Favorites Error:", error.message);
    res.status(500).json({ error: { message: error.message } });
  }
});

// Search Picnic
app.get("/api/picnic/search", async (req, res) => {
  const { term } = req.query;
  const token = req.headers["x-picnic-auth"] as string;
  const country = req.headers["x-picnic-country"] as string;
  const picnic = getPicnicClient(token, country);
  try {
    const results = await picnic.catalog.search(term as string);
    // Map SellingUnit to PicnicProduct interface and deduplicate
    const seenIds = new Set();
    const mapped: any[] = [];
    const alternateRoute = picnic.url.split("/api/")[0];

    results.forEach((item: any) => {
      if (item && item.id && !seenIds.has(item.id)) {
        seenIds.add(item.id);
        mapped.push({
          id: item.id,
          name: item.name,
          image: item.image_id ? `${alternateRoute}/static/images/${item.image_id}/medium.png` : undefined,
          price: item.display_price,
          unit_quantity: item.unit_quantity,
          unit_name: item.unit_name,
          price_per_unit_text: item.unit_price_text
        });
      }
    });

    res.json(mapped);
  } catch (error: any) {
    console.error("Picnic Search Error:", error.message);
    res.status(500).json({ error: { message: error.message } });
  }
});

// Add to basket
app.post("/api/picnic/basket/add", async (req, res) => {
  const { product_id, count } = req.body;
  const token = req.headers["x-picnic-auth"] as string;
  const country = req.headers["x-picnic-country"] as string;
  const picnic = getPicnicClient(token, country);
  try {
    const result = await picnic.cart.addProductToCart(product_id, count || 1);
    res.json(result);
  } catch (error: any) {
    console.error("Picnic Add Product Error:", error.message);
    res.status(500).json({ error: { message: error.message } });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
