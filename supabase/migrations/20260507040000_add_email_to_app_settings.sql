/*
  # Add email column to app_settings

  Adds an optional email field per-user account (stored in app_settings since
  app_settings is already keyed by user_id and per-user).
*/

ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS email text;
