# Picnic Shopping Helper for Families and Shared Households 🛍️🤖

Picnic Shopping Helper is an AI-powered shopping assistant specifically designed for families and shared households. It bridges the gap between your natural language shopping list and the Picnic grocery delivery service, ensuring that everyone in your home can contribute to a single, intelligent list without the guesswork.

> [!TIP]
> **Multi-Country Support**  
> Matchie supports Picnic accounts in **Germany (🇩🇪)**, the **Netherlands (🇳🇱)**, and **France (🇫🇷)**. Select your region during the setup process to sync the correct catalogue.

## ✨ Key Features

- **Natural Language Shopping List**: Just type what you need (e.g., "Bananas", "Bread", "Oat Milk"). No need to search for every specific product manually.
- **AI-Powered Product Matching**: Uses Google Gemini to semantically match your list items to your Picnic favourites and catalogue.
- **Personalised Memory**: The AI learns from your corrections. If you manually pick a specific brand for "milk", the system remembers it and applies it automatically next time.
- **Direct Picnic Sync**: Connect your Picnic account (DE, NL, or FR) to pull your favourite products and sync your completed list directly to your Picnic basket.
- **Collective Household Shopping**: Built on Firebase, allowing family members or roommates to manage and view the shopping list together in real-time. Stop guessing what is in the fridge—let everyone add their missing items as they run out.
- **Household Management Centre**: An administrative interface where the first user (Admin) can manage account access and configure the shared Picnic connection.

## 👥 User Roles & Household Setup

This app follows a "First-In, Admin" architectural pattern designed for private household security:

1.  **The Administrator**: The very first person to create an account via Google Login is automatically assigned the **Admin** role.
2.  **Picnic Connection**: Only the Admin has the authority to enter and save the shared Picnic login credentials. Once saved, these credentials power the catalogue matching for the entire household.
3.  **Family Invitations**: To keep your list private, the app is restricted by default. The Admin must explicitly add the email addresses of family members or housemates in the **Management Centre** to grant them access.
4.  **Shared List**: Once invited, all members see the same real-time list, AI matches, and memory, making grocery shopping a truly collaborative effort.

## 🛠️ Tech Stack

- **Framework**: [React 19](https://react.dev/) + [Vite](https://vitejs.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS 4.0](https://tailwindcss.com/)
- **Animations**: [Motion](https://motion.dev/)
- **Backend**: [Node.js](https://nodejs.org/) + [Express](https://expressjs.com/)
- **Database & Auth**: [Firebase](https://firebase.google.com/) (Firestore & Authentication)
- **AI Engine**: [Google Gemini Pro/Flash](https://ai.google.dev/)
- **API Integration**: [picnic-api](https://www.npmjs.com/package/picnic-api)

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or higher)
- A Firebase Project
- A Google AI Studio API Key (for Gemini)
- A Picnic Account

### Installation

1.  **Clone the repository**:
    ```bash
    git clone <your-repo-url>
    cd picnic-list-architect
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Environment Setup**:
    Create a `.env` file in the root directory and add the following variables:
    ```env
    GEMINI_API_KEY=your_gemini_api_key
    # Firebase Client Config (from Firebase Console)
    VITE_FIREBASE_API_KEY=...
    VITE_FIREBASE_AUTH_DOMAIN=...
    VITE_FIREBASE_PROJECT_ID=...
    VITE_FIREBASE_STORAGE_BUCKET=...
    VITE_FIREBASE_MESSAGING_SENDER_ID=...
    VITE_FIREBASE_APP_ID=...
    VITE_FIREBASE_DATABASE_ID=(default)
    ```

4.  **Firebase Configuration**:
    - The app uses environment variables for Firebase initialization. You can find these values in your Firebase Console under Project Settings > General > Your apps. Add them to your `.env` file as shown above.
    - **Authorized Domains**: To enable Google Login in production, you MUST add your deployment domain (e.g., `ais-pre-....run.app` or `yourdomain.com`) to the **Authorized Domains** list in the Firebase Console under **Authentication > Settings > Authorized domains**. 
      > **Important**: If the domain is not authorized, OAuth operations (like `signInWithPopup` or `signInWithRedirect`) will fail with an error. Adding your domain to the authorized domains list ensures these methods work correctly.

5.  **Run the application**:
    ```bash
    npm run dev
    ```
    The app will be available at `http://localhost:3000`.

## 🌐 Production Deployment

For a stable production environment on your own server (e.g., Ubuntu VPS), it is highly recommended to use a process manager like **PM2**.

### 1. Install PM2 Globally
Yes, installing PM2 globally allows it to manage and monitor processes across your entire system.
```bash
sudo npm install -g pm2
```

### 2. Build for Production
First, generate the optimized frontend assets:
```bash
npm run build
```

### 3. Start with PM2
Launch the server using PM2. This will ensure your app automatically restarts if it crashes or if the server reboots.
```bash
pm2 start npm --name "matchie" -- start
```

### 4. Monitor & Logs
- **Check status**: `pm2 status`
- **View logs**: `pm2 logs matchie`
- **Restart**: `pm2 restart matchie`
- **Stop**: `pm2 stop matchie`

### 5. (Optional) Run on Startup
To make PM2 start your app automatically after a server reboot:
```bash
pm2 startup
pm2 save
```

## 🧠 How it Works

### The Matching Engine
When you add an item to the list, the system:
1. Checks the **Local Memory** (Firestore) for existing mappings for that term.
2. If no exact match is found, it queries **Gemini AI** with a curated list of your Picnic Favourites and the search term.
3. Gemini returns the most likely product or a selection of "best fit" candidates for you to choose from.

### The Memory Manager
Every time you manually select a product for a term, an entry is created in a "Memory" collection. This correction is fed back into Gemini's prompt as context (Few-Shot Prompting), ensuring the AI adapts to your household's specific preferences over time.

## 🔒 Security

- **Authentication**: Secured by Firebase Auth. Only invited users can access the system.
- **Data Privacy**: Picnic credentials (username/password) are **never stored** in the database. They are only used to obtain a temporary session token from Picnic.
- **Firestore Rules**: Strict security rules ensure that users can only access their own lists and memory data.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
