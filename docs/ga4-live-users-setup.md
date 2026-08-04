# GA4 "Live Visitors" widget — setup

The admin dashboard's Live Visitors badge calls Google's GA4 Realtime Data
API to show the same "active users right now" number GA itself shows in its
Realtime report. It needs three things from Google Cloud, set as backend env
vars (`GA4_PROPERTY_ID`, `GA4_CLIENT_EMAIL`, `GA4_PRIVATE_KEY`). Until those
are set, the widget just doesn't render — nothing else is affected.

This is a one-time setup, done in Google's consoles (not this codebase).

## 1. Find your GA4 Property ID

1. Go to [analytics.google.com](https://analytics.google.com) and open the RECODE / FitWithSudarshan property.
2. Click **Admin** (gear icon, bottom left).
3. Under the **Property** column, click **Property details**.
4. Copy the **Property ID** — a plain number like `123456789`.
   (This is *not* the same as the `G-XXXXXXX` Measurement ID already in `index.html` — that one's for the tracking snippet, this one's for the API.)

## 2. Create a Google Cloud service account

1. Go to [console.cloud.google.com](https://console.cloud.google.com). Use the same Google account that has access to your GA4 property, or any account/project — it just needs to be granted access in step 4.
2. If you don't already have a project, create one (top left project picker → **New Project**). Any name is fine.
3. In the search bar, search for **"Google Analytics Data API"** and open it, then click **Enable**.
4. Go to **APIs & Services → Credentials**.
5. Click **Create Credentials → Service account**.
6. Give it any name (e.g. `ga4-dashboard-reader`), click through the remaining steps with defaults, then **Done**.
7. Click into the service account you just created → **Keys** tab → **Add Key → Create new key → JSON**. This downloads a `.json` file — keep it private, don't commit it to the repo.

## 3. Grant that service account access to your GA4 property

1. Open the downloaded JSON file and copy the `client_email` value (looks like `ga4-dashboard-reader@your-project.iam.gserviceaccount.com`).
2. Back in [analytics.google.com](https://analytics.google.com) → **Admin** → under **Property**, click **Property Access Management**.
3. Click the **+** button → **Add users**.
4. Paste the service account's email, set role to **Viewer**, and save.

## 4. Set the backend env vars

From the same JSON file:

| Env var | Value |
|---|---|
| `GA4_PROPERTY_ID` | The numeric property ID from step 1 |
| `GA4_CLIENT_EMAIL` | The `client_email` field from the JSON |
| `GA4_PRIVATE_KEY` | The `private_key` field from the JSON |

The private key in the JSON file spans multiple lines and starts with
`-----BEGIN PRIVATE KEY-----`. Most `.env` files can't hold real line
breaks, so paste it as a single line with literal `\n` in place of the line
breaks — most JSON viewers already show it this way (e.g.
`"-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----\n"`).
Copy that whole string, quotes included is fine either way, as the value.

Example `.env` line:
```
GA4_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n"
```

Add all three to `FitWithSudarshan-Backend/.env` (same file as your Supabase/Razorpay keys) — and to your production hosting's environment variables (Vercel project settings, etc.) if this runs there too.

## 5. Restart the backend

Once the three env vars are set and the backend restarts, the Live Visitors badge appears automatically on the admin dashboard within ~15 seconds — no further code changes needed.

If it doesn't show up: check the backend logs for `[analytics] getLiveUsers failed` — the most common causes are the service account not yet having Viewer access on the property (step 3), or the property ID being wrong (step 1).
