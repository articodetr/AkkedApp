# send-movement-push

Supabase Edge Function for sending Akked push notifications through Expo Push Service.

## Required secrets

Set these secrets before deploying:

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
supabase secrets set PUSH_WEBHOOK_SECRET=generate-a-long-random-secret
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are provided by Supabase automatically.

## Deploy

Deploy with JWT verification disabled because database webhooks authenticate with
`PUSH_WEBHOOK_SECRET`, while app test requests still pass the user's JWT and are
validated inside the function.

```bash
supabase functions deploy send-movement-push --no-verify-jwt
```

## Database Webhook

Create a Database Webhook in Supabase Dashboard:

- Table: `public.movement_notifications`
- Events: `INSERT`
- Method: `POST`
- URL: `https://hnaudgieczuzuduplhkp.supabase.co/functions/v1/send-movement-push`
- Header: `x-push-webhook-secret: <same PUSH_WEBHOOK_SECRET value>`

The function ignores non-`INSERT` events and sends notifications only to active
tokens in `public.device_push_tokens`.
