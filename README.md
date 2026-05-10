# Picnic Shopping Helper (Matchie) 🛍️🤖

**Picnic Shopping Helper** is an AI-powered shopping assistant specifically designed for families and shared households (housemates). It bridges the gap between your natural language shopping list and the Picnic grocery delivery service, ensuring that everyone in your home can contribute to a single, intelligent list without the guesswork.

> [!TIP]
> **Multi-Country Support** > Matchie supports Picnic accounts in **Germany (🇩🇪)**, the **Netherlands (🇳🇱)**, and **France (🇫🇷)**. Select your region during the setup process to sync the correct catalogue.

---

## ✨ Key Features

* **Natural Language Shopping List**: Simply type what you need (e.g., "Bananas", "Bread", "Oat Milk"). The AI handles the interpretation.
* **AI-Powered Product Matching**: Utilises **Google Gemini** to semantically match your list items to your Picnic favourites and the wider catalogue.
* **Personalised Memory**: The AI learns from your choices. If you manually select a specific brand of milk, the system remembers and prioritises it for future lists.
* **Direct Picnic Sync**: Connect your Picnic account to pull your personal favourites and sync your completed list directly to your Picnic basket.
* **Collaborative Shopping**: Built on Firebase, allowing all members of a household to manage the list in real-time. No more "did anyone buy eggs?" – the list is always live and synced.
* **Management Centre**: An administrative interface where the first user (Admin) manages account access and configures the shared Picnic connection.

---

## 🛠️ Tech Stack

* **Frontend**: [React 19](https://react.dev/) + [Vite](https://vitejs.dev/) + [Tailwind CSS 4.0](https://tailwindcss.com/)
* **Backend**: [Node.js](https://nodejs.org/) + [Express](https://expressjs.com/) (Running via [tsx](https://www.google.com/search?q=https://tsx.is/))
* **Process Management**: [PM2](https://pm2.keymetrics.io/)
* **AI Engine**: [Google Gemini 1.5 Pro/Flash](https://ai.google.dev/)
* **Database & Auth**: [Firebase](https://firebase.google.com/) (Firestore & Auth)

## 🖥️ Hardware Requirements

For a stable production environment, particularly when running the build process on the same machine, the following specifications are recommended:

| Resource | Minimum Requirements | Recommended |
| --- | --- | --- |
| **CPU** | 1 Core | 2 Cores |
| **Memory** | 1 GB (with 1 GB Swap) | 2 GB (with 2 GB Swap) |
| **Disk** | 4 GB | 8 GB |

> [!NOTE]
> **A note on Memory**: While the application runs efficiently on 1 GB of RAM, the `npm run build` process for the frontend is memory-intensive. If you are on the minimum requirements, ensure you have **Swap Space** enabled to prevent the build from crashing.

---

## 💻 Local Development

### 1. Prerequisites

* Node.js (v20 or higher recommended)
* A Google AI Studio API Key (for Gemini)
* A Firebase Project

### 2. Installation

```bash
git clone <your-repo-url>
cd matchie
npm install

```

### 3. Environment Setup

Create a `.env` file in the root directory:

```env
# Backend
GEMINI_API_KEY=your_key_here

# Frontend (Firebase Config)
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...

```

### 4. Run Development Servers

Start both the Vite frontend and the Express backend:

```bash
npm run dev

```

---

## 🌐 Production Deployment (Server/LXC)

When deploying to a production server (e.g., a Debian LXC on Proxmox), follow these steps for a stable, high-performance setup.

### 1. Global Prerequisites

Install **PM2** globally to manage your processes and ensure they restart after a reboot.

```bash
sudo npm install -g pm2

```

### 2. Frontend Build (The RAM Trick)

Vite builds can be memory-intensive. If your server/container has limited RAM (e.g., 2GB or less), the build might crash. Use the following command to increase the memory limit for the build process:

```bash
# Force Node to use up to 4GB RAM for the build
NODE_OPTIONS="--max-old-space-size=4096" npm run build

```

This generates the optimised files in the `/dist` folder.

### 3. Backend Management with PM2

We use `tsx` to run the TypeScript backend directly in production for flexibility. To keep the backend running 24/7:

```bash
# Start the backend and name the process
pm2 start "npx tsx server/server.ts" --name matchie-backend

# Ensure it starts on system boot
pm2 startup
pm2 save

```

### 4. Nginx Reverse Proxy

To serve the frontend and route API calls to the backend, an Nginx configuration is required. Create a new site config (e.g., `/etc/nginx/sites-available/matchie`):

```nginx
server {
    listen 80;
    server_name your-ip-or-domain;

    # Frontend: Serve the built static files
    root /var/www/matchie/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Backend: Proxy /api requests to the Express server
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

```

*After saving, enable the config: `ln -s /etc/nginx/sites-available/matchie /etc/nginx/sites-enabled/` and restart Nginx.*

---

## ☁️ Remote Access & Networking (Add-on)

If your server is behind a firewall or home router and you want to access Matchie from anywhere without opening ports, **Tailscale** is the recommended solution.

### Tailscale Funnel (Public Access)

To make your project available to the public internet via a secure URL (e.g., `https://matchie.ts.net`), you can use Tailscale Funnel:

1. **Install Tailscale** on your server.
2. **Serve the local port**:
```bash
tailscale serve http://localhost:80

```


3. **Activate the Funnel**:
```bash
tailscale funnel 443 on

```

---

## 🔒 Security & Privacy

* **Authentication**: Secured by Firebase Auth. Only invited emails added by the Admin can access the household list.
* **Picnic Credentials**: Picnic login details are **never stored** in the database. They are only used to fetch a temporary session token.
* **Environment Variables**: Always keep your `.env` file out of version control (it is included in `.gitignore`).

*Note: Ensure your Firebase "Authorized Domains" includes your Tailscale URL to allow Google Login to function.*

---

## 📄 License

This project is licensed under the MIT License.