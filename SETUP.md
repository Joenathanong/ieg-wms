# WMS Dashboard — Setup & Deployment Guide

## Prerequisites
- Node.js 18+
- Firebase project (free Spark plan or paid)
- Google Cloud project with Sheets API enabled
- Vercel account (free)

---

## 1. Firebase Setup

### 1a. Create a Firebase Project
1. Go to https://console.firebase.google.com
2. Click **Add project** → name it (e.g. `eji-wms`)
3. Enable **Google Analytics** (optional)

### 1b. Enable Firebase Auth
1. In Firebase Console → **Authentication** → **Get Started**
2. Under **Sign-in method**, enable **Email/Password**

### 1c. Enable Firestore
1. **Firestore Database** → **Create database**
2. Choose **Production mode** → pick region (e.g. `asia-southeast1`)

### 1d. Firestore Security Rules
Paste these rules in **Firestore → Rules**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Semua user yang sudah login boleh baca & tulis
    // (akses per role dikontrol di sisi aplikasi/UI)
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### 1e. Firebase Web App Config
1. **Project Settings** → **General** → **Your apps** → click **</>** (Web)
2. Register app, copy the `firebaseConfig` object

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCGRqTY2GlFl35NwkUR9hd4ZuhFsWAJC-U",
  authDomain: "ieg-wms.firebaseapp.com",
  projectId: "ieg-wms",
  storageBucket: "ieg-wms.firebasestorage.app",
  messagingSenderId: "22744261415",
  appId: "1:22744261415:web:df2e7f438afcd47040bf02"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

3. These values go into `.env.local` as `NEXT_PUBLIC_FIREBASE_*`

### 1f. Firebase Admin Service Account
1. **Project Settings** → **Service Accounts** → **Generate new private key**
2. Download the JSON file
3. **Minify** it to one line (remove newlines) and paste as `FIREBASE_SERVICE_ACCOUNT_JSON`
   - Important: In the `private_key` value, `\n` must remain as literal `\n` (not actual newlines)

---

## 2. Google Sheets Setup

### 2a. Enable Google Sheets API
1. Go to https://console.cloud.google.com
2. Select the same (or different) project
3. **APIs & Services** → **Enable APIs** → search **Google Sheets API** → Enable

### 2b. Create a Service Account
1. **APIs & Services** → **Credentials** → **Create Credentials** → **Service account**
2. Name it (e.g. `wms-sheets-sa`), click **Done**
3. Click the service account → **Keys** → **Add Key** → **JSON**
4. Download and minify to one line → `GOOGLE_SERVICE_ACCOUNT_JSON`

### 2c. Share the Spreadsheet
1. Open your Google Sheet
2. Click **Share**
3. Paste the service account email (e.g. `wms-sheets-sa@your-project.iam.gserviceaccount.com`)
4. Give it **Editor** access (needed to write GR data)

### 2d. Spreadsheet ID
From the URL: `https://docs.google.com/spreadsheets/d/**THIS_PART**/edit`
Set as `SPREADSHEET_ID`

---

## 3. Local Development

```bash
cd wms-app
npm install
cp .env.local.example .env.local
# Edit .env.local with your values
npm run dev
```

### Create First Admin User
Since user creation requires Admin SDK, run this once in the Firebase Console:
1. **Authentication** → **Users** → **Add user**
2. Enter email + password
3. Copy the UID
4. **Firestore** → **users** collection → **Add document** with ID = that UID:
   ```json
   {
     "name": "Admin",
     "email": "your@email.com",
     "role": "admin",
     "active": true,
     "createdAt": "2026-06-22T00:00:00.000Z"
   }
   ```
5. Log in at `/login` — you now have admin access to create other users

---

## 4. Vercel Deployment

### 4a. Push to GitHub
```bash
git init
git add .
git commit -m "Initial WMS dashboard"
git remote add origin https://github.com/your-org/eji-wms.git
git push -u origin main
```

### 4b. Import to Vercel
1. Go to https://vercel.com/new
2. Import your GitHub repo
3. **Framework**: Next.js (auto-detected)
4. **Root Directory**: `wms-app`

### 4c. Set Environment Variables
In Vercel → **Settings** → **Environment Variables**, add all variables from `.env.local.example`:

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | from Firebase config |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | from Firebase config |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | from Firebase config |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | from Firebase config |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | from Firebase config |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | from Firebase config |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | minified JSON (one line) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | minified JSON (one line) |
| `SPREADSHEET_ID` | from Google Sheets URL |
| `SHEET_NAME` | `List_PO` |

### 4d. Deploy
Click **Deploy**. Vercel will build and deploy automatically.

Add your Vercel domain to Firebase Auth:
1. **Firebase Console** → **Authentication** → **Settings** → **Authorized domains**
2. Add your Vercel domain (e.g. `eji-wms.vercel.app`)

---

## 5. Firestore Initial Data

### Settings (shift schedule)
Create document `settings/shifts`:
```json
{
  "numShifts": 2,
  "shifts": [
    { "name": "Shift 1", "logoutTime": "15:30" },
    { "name": "Shift 2", "logoutTime": "23:00" }
  ]
}
```

---

## 6. Pages Overview

| URL | Access | Description |
|-----|--------|-------------|
| `/login` | Public | Login page |
| `/dashboard` | All roles | Dashboard with 6 filter cards |
| `/open-po` | All roles | Open PO monitoring from Google Sheets |
| `/receiving` | All roles | PDA barcode receiving (GR input) |
| `/stock` | Admin, Supervisor | Stock monitoring + Excel upload |
| `/master-items` | Admin only | OCS ↔ SAP1/SAP2 mapping |
| `/users` | Admin only | User management (CRUD) |
| `/settings` | Admin only | Shift configuration |
| `/monitor` | **Public (no login)** | Pending PO monitor with CSV export |

---

## 7. Barcode Format (Zebra DataWedge)

Expected format (semicolon-separated):
```
1201020711;D26158;CTN;12.00000;PCS;852600153;Hanasui Glow Expert 4pack x 12
[0] SAP Code | [1] Batch | [2] Unit | [3] Qty/Carton | [4] Unit2 | [5] internal | [6] Description
```

DataWedge config on Zebra PDA:
- Profile → Keystroke Output → Enable
- Add suffix: **ENTER** (so each scan auto-submits)
- Ensure Chrome browser is in the profile

---

## 8. Troubleshooting

**Session not persisting**: Check `FIREBASE_SERVICE_ACCOUNT_JSON` is valid JSON, not truncated.

**Google Sheets not reading**: Verify service account email has been added as editor to the spreadsheet.

**"Forbidden" on GR submit**: Ensure user has `active: true` in Firestore `users` collection.

**Auto-logout not working**: `shift_logout_times` is cached in `localStorage` at login. If you change shift times in Settings, users must re-login for changes to take effect.
