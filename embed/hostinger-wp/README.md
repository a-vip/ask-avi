# Deploying Ask Avi on aviperera.com/ask-avi (Hostinger WordPress)

Because Hostinger shared plans serve clean subfolder URLs natively without needing subdomains or external Vercel/Cloudflare deployments, this bundle installs directly inside your active WordPress theme (`avi-wp-theme`).

## Files Included Here

- `apps/ask-avi/.htaccess` — LiteSpeed/Apache routing (`./api/chat` -> `api/chat.php`, `./api/auth` -> `api/auth.php`) + unbuffered SSE streaming headers.
- `apps/ask-avi/api/wp-bootstrap.php` — WordPress session integration (`wp_get_current_user()`), MySQL user & log tables (`wp_ask_avi_users`, `wp_ask_avi_logs`), and signed session tokens.
- `apps/ask-avi/api/chat.php` — Free open-source reasoning/fast proxy (Groq -> OpenRouter `:free`) + optional Google Gemini fallback with per-request error & latency telemetry.
- `apps/ask-avi/api/auth.php` — Google Sign-In ID token verification (`oauth2.googleapis.com/tokeninfo`), Email Sign-Up/Sign-In, Admin analytics JSON feed, and client diagnostic logging.
- `apps/ask-avi/index.html` & `assets/` — Built production frontend synchronized via `npm run build:wp`.
- `page-ask-avi.php` — WordPress Page Template rendering full-bleed Ask Avi on `https://aviperera.com/ask-avi/`.
- `inc/ask-avi-admin.php` — WordPress Dashboard menu (`WP Admin -> Ask Avi`) for storing secret API keys in `wp_options`, viewing/exporting registered users CSV, and inspecting troubleshooting logs.

## Deployment Steps into `avi-wp-theme`

1. Build and sync assets:
   ```bash
   npm run build
   npm run build:wp
   ```
2. Copy into your WordPress theme (`avi-wp-theme`):
   - `embed/hostinger-wp/apps/ask-avi/` -> `avi-wp-theme/apps/ask-avi/`
   - `embed/hostinger-wp/page-ask-avi.php` -> `avi-wp-theme/page-ask-avi.php`
   - `embed/hostinger-wp/inc/ask-avi-admin.php` -> `avi-wp-theme/inc/ask-avi-admin.php`
3. In `avi-wp-theme/functions.php`, load the admin module:
   ```php
   require_once get_template_directory() . '/inc/ask-avi-admin.php';
   ```
4. Commit & push `avi-wp-theme` so Hostinger receives the update, then in **WordPress Admin**:
   - Open **Pages -> Add New**, set slug **`ask-avi`**, choose Page Template **`Ask Avi (Native Hostinger WordPress Subfolder)`**, and Publish.
   - Open **WP Admin -> Ask Avi**, enter your **Groq Free API Key**, **OpenRouter Free API Key**, optional **Gemini API Key**, **Google OAuth Client ID**, and an **Admin Fallback Passcode**, then click **Save Settings**.

## Enabling Google Sign-In (`GOOGLE_CLIENT_ID`)

1. Open [Google Cloud Console -> Credentials](https://console.cloud.google.com/apis/credentials).
2. Create an **OAuth client ID** of type **Web application**.
3. Under **Authorized JavaScript origins**, add:
   - `https://aviperera.com`
   - `http://localhost:4173` (for local testing)
4. Paste the resulting Client ID (`...apps.googleusercontent.com`) into **WP Admin -> Ask Avi** (and `GOOGLE_CLIENT_ID=...` in `.env.local` locally).
5. Ensure the signed-in Google account matches `workwithavip@gmail.com` to automatically unlock the frontend **Admin & Analytics** and **APIs & Deployment** tabs.
