-- Add customer email and allow account-only registration before first-login profile setup.
-- Existing customers receive reserved .invalid addresses; these are placeholders, not Gmail accounts.
BEGIN;

ALTER TABLE khach_hang
  ADD COLUMN IF NOT EXISTS email varchar(254);

ALTER TABLE khach_hang
  ALTER COLUMN ho_ten DROP NOT NULL,
  ALTER COLUMN nam_sinh DROP NOT NULL,
  ALTER COLUMN so_thich_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_khach_hang_email_ci
  ON khach_hang (lower(email))
  WHERE email IS NOT NULL;

UPDATE khach_hang
   SET email = 'customer' || lpad(tai_khoan_id::text, 8, '0') || '@example.invalid'
 WHERE email IS NULL OR btrim(email) = '';

COMMIT;
