# Email verification and account cleanup (IDE-152)

## What changed

- **Registration** needs name, email, password and confirmation. New accounts start
  **unverified** with a fixed **7-day deadline** and get no session.
- **Verification link**: single-use, valid 24 hours, newest link only. Only a SHA-256
  hash is stored. The link page verifies on a button click (mail scanners cannot use it up).
- **Resend / email correction** from `/check-email`, using a restricted 60-minute
  credential returned by registration or by a sign-in attempt with the correct password.
  Together limited to 3 per rolling 24 hours, with a 60-second cooldown (the registration
  email also starts the cooldown). Neither moves the deadline.
- **Sign-in, sessions and registered checkout** refuse unverified and expired accounts.
- **Day 6**: one final reminder with a fresh link. **Day 7**: the account expires
  immediately (cannot sign in or verify) and is **deleted only if** the mail server
  accepted the first verification email sent to its current address (outbox `state: sent`).
  Queued, failed, interrupted or disabled delivery pauses deletion; admins see
  "Deletion paused" in `/admin/users`. Async bounces after acceptance are not detected.
- **Never affected**: accounts created before this feature (no `verificationRequired`),
  verified accounts, admin accounts and orders (orders keep their own customer snapshot).
- **Guest checkout** needs a 6-digit email code (10 minutes, 5 attempts, single use)
  bound to the order email and the checkout attempt's `Idempotency-Key`. Order
  creation checks the resulting proof (`X-Checkout-Email-Proof`) on the server.
  Retries with the same key still return the original order.

## Operations

- The cleanup job runs inside the server every 15 minutes, whether or not email is
  configured. Set `ESCOWEAR_ACCOUNT_CLEANUP_DRY_RUN=true` to log counts without deleting.
  Logs contain counts only.
- **Guest checkout depends on email delivery.** With `EMAIL_TRANSPORT=none` guests never
  receive their code and cannot order.
- **Indexes**: new User, EmailOutbox and `CheckoutEmailChallenge` indexes are created by
  `npm run db:ensure-order-indexes` (additive only). Run it in production only after a
  backup and with deployment approval.
- No data migration: existing accounts are left exactly as they are.
