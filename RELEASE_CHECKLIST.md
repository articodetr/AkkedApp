# Akked Release Checklist

Use this checklist before every Google Play upload.

## 1. Local checks

```bash
npm run typecheck
npx expo config --type public --json
```

Confirm:

- Android package stays `com.articode.akked`.
- Production builds remain Android App Bundles (`AAB`).
- `production.autoIncrement` remains enabled in `eas.json`.

## 2. Supabase push setup

Apply the latest database migrations, including `device_push_tokens`.

Deploy the push Edge Function:

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
supabase secrets set PUSH_WEBHOOK_SECRET=generate-a-long-random-secret
supabase functions deploy send-movement-push --no-verify-jwt
```

Create a Supabase Database Webhook:

- Table: `public.movement_notifications`
- Event: `INSERT`
- Method: `POST`
- URL: `https://hnaudgieczuzuduplhkp.supabase.co/functions/v1/send-movement-push`
- Header: `x-push-webhook-secret: <same PUSH_WEBHOOK_SECRET value>`

## 3. Android testing

Build a real Android build; Expo Go is not enough for push notification testing.

```bash
eas build --platform android --profile preview
```

Test:

- Log in on a physical Android device.
- Accept notification permission.
- Open account settings and tap `اختبار الإشعارات`.
- Verify the notification arrives while the app is open, in background, and fully closed.
- Tap the notification and confirm it opens the notifications screen.
- Create a linked-account movement and confirm the other user receives a push notification.

## 4. Production build

When the preview build passes:

```bash
eas build --platform android --profile production
```

Upload the generated `.aab` to Google Play Console.

## 5. Updates after first release

- Increase `expo.version` only for user-visible releases, for example `1.0.1`.
- Let EAS remote auto increment Android `versionCode`.
- Run local checks and preview push tests before production.
- After Google Service Account setup, submit updates with:

```bash
eas submit --platform android --profile production
```
