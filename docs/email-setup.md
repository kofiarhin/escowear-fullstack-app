# Email setup (SMTP)

**Preparation only:** production setting changes and test-email sends need owner
approval. A login-only check passed on 24 October 2026; inbox delivery and replies
remain unverified. See [the launch checklist](mvp-launch-checklist.md).

The owner's proposed support mailbox is **support@escowear.com — UNVERIFIED**.
The Gmail login check did not verify it. It is stored as a draft business detail in
`client/src/policies/review.json`, with `seller.emailVerified: false`. The template
keeps `EMAIL_REPLY_TO` unset and email transport disabled. Do not use the proposed
support address as a sender or reply destination until the owner confirms control
and an approved receipt-and-reply test passes. A Gmail sender and a support inbox
can be different mailboxes; verify both paths. Record evidence privately and then
update the verification flag only for the address actually tested.

EscoWear sends its order emails over SMTP: order received, payment instructions, payment issue, order confirmed, status updates and tracking codes. The MVP uses **Gmail**. Any other SMTP provider works by changing only `.env`; no code changes are needed.

Until email is configured (`EMAIL_TRANSPORT=none`), orders still work. Emails wait in the queue and admins can see them on each order.

## 1. Create a Gmail App Password

Gmail does not accept your normal password over SMTP. It needs a 16-character **App Password**.

1. Sign in to the Google Account you will send from.
2. App Passwords require **2-Step Verification**. Some managed, Advanced Protection or security-key-only accounts cannot use them; see [Google's App Password instructions](https://support.google.com/accounts/answer/185833?hl=en). Do not change account security settings without owner approval.
3. Open <https://myaccount.google.com/apppasswords>, or search the account settings for "App passwords".
4. Enter a name such as `EscoWear server`, then select **Create**.
5. Google shows a 16-character password, for example `abcd efgh ijkl mnop`. Copy it now; it is only shown once.
6. Put it only in the server's private `.env` file (next section). Never paste it into chat, Linear, GitHub or email.

If the password ever leaks, revoke it on the same page and create a new one. That doesn't affect your normal Google password.

## 2. Add the settings to the server's `.env`

```dotenv
EMAIL_TRANSPORT=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=<your Gmail address>
SMTP_PASS=<the 16-character App Password>
EMAIL_FROM=EscoWear <your Gmail address>
EMAIL_REPLY_TO=<optional: where customer replies and payment screenshots should go>
ESCOWEAR_PUBLIC_URL=https://escowear.com
```

- Gmail sends only from your own address (or an alias verified in Gmail), so `EMAIL_FROM` must use the same address as `SMTP_USER`.
- Personal Gmail may block sending above 500 messages in a day; Workspace limits differ. Monitor the outbox: each order creates several messages and tracking requests add more. See [Google's sending limits](https://support.google.com/mail/answer/22839?hl=en).

## 3. Check it, without creating an order

```bash
npm run email:check                                   # logs in only
npm run email:check -- --send-to <your address>       # also sends one test email
```

The output masks the username and never prints the password.

## Switching provider later

Change only these values:

| Provider | `SMTP_HOST` | `SMTP_PORT` | `SMTP_SECURE` |
|---|---|---|---|
| Gmail / Google Workspace | `smtp.gmail.com` | 465 | true |
| Zoho Mail | `smtp.zoho.com` | 465 | true |
| Resend | `smtp.resend.com` | 465 | true |
| Brevo | `smtp-relay.brevo.com` | 587 | false (STARTTLS is required) |

Then update `SMTP_USER`, `SMTP_PASS` and `EMAIL_FROM` for the new provider. On port 587 the server refuses to send unless the connection upgrades to TLS (STARTTLS).

## Safety built in

- The password is read only from the environment. It is never logged, stored in the database or shown in admin screens.
- A bad or missing email setting does not stop the shop: the server logs which setting is wrong (by name) and keeps emails queued.
- Failed sends retry up to 5 times with backoff, then show as failed on the admin order page with a Retry button.
- After sending, payment-instruction and tracking-code email bodies are deleted from the database.
