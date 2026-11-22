# Habit Matrix — setup guide

An installable app for your phone (CMF Phone 2 Pro) and your PC. It works offline and syncs through your Google account when you're online.

About 15 minutes, once. You need a Google account and a free GitHub account.

---

## Part 1 — Sync service (Firebase): already done

Your Firebase project **habit-matrix** (`habit-matrix-87fde`) is set up: Google sign-in is on, the database is in Belgium (europe-west1), the privacy rules are published, and `firebase-config.js` already contains your settings.

The only Firebase step left is in Part 2, step 6: allowing your GitHub address.

---

## Part 2 — Put the app online (GitHub Pages, free)

1. Sign in at **github.com** (or create an account).
2. Click **+ → New repository**. Name it `habit-matrix` and set it to **Public** (free GitHub Pages needs that; only the app's code is public, never your data). Click **Create repository**.
3. On the new repository page, click **uploading an existing file**. Drag in **everything in this folder**: `index.html`, `app.js`, `sw.js`, `manifest.webmanifest`, `firebase-config.js`, `README.md` and the **`icons` folder**. Click **Commit changes**.
4. Go to **Settings → Pages**. Under *Build and deployment*, set *Source* to **Deploy from a branch**, the branch to **main** and the folder to **/ (root)**, then click **Save**.
5. After a minute or two, the page shows your app's address:
   **`https://YOUR-USERNAME.github.io/habit-matrix/`**
6. **Let Firebase accept sign-ins from that address:** back in Firebase, open **Authentication → Settings → Authorized domains → Add domain** and enter `YOUR-USERNAME.github.io`.

---

## Part 3 — Install it

**On your CMF Phone 2 Pro:** open the address in **Chrome**. Tap **⋮ → Add to home screen → Install** (or tap *Install app* on the Habits tab). It opens full-screen like any other app.

**On your PC:** open the address in **Chrome or Edge**. Click the **install icon** at the right of the address bar (a screen with a down arrow), then **Install**. It gets its own window and a Start-menu entry.

Then, on each device: **Habits tab → Sign in with Google**, using the **same Google account** on both.

---

## How it behaves

- **Offline:** everything works: ticking habits, writing your diary, stats. Changes are saved on the device and sync automatically when you're back online. The top-right corner shows *Synced*, *Syncing…* or *Offline · will sync*.
- **Diary:** in the morning, write one plan per line. Lines that start with a time (`07:00 Gym`, `14:00-15:00 Dentist`) get a **+ Calendar** button that opens Google Calendar with the event filled in. In the evening, write about your day and tap **Check my day**. It ticks off the plans your notes mention and suggests habits to tick. It works by matching words on your device, not with AI, so it can occasionally miss or guess wrong; you can always tick things by hand.
- **Voice typing:** tap the microphone on either diary box. This uses Chrome's speech recognition, so it **needs an internet connection**. Offline, use the microphone on your phone's keyboard instead.
- **Backup:** *Habits → Export backup* saves a file with all your data. *Import backup* merges one back in.

## Updating the app later

Upload the new files to the same GitHub repository (they'll replace the old ones). Each device picks up the new version the next time you open the app, and shows it the time after.
