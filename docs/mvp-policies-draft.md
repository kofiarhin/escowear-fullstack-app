# EscoWear MVP policies

> **Status (30 Oct 2026): owner-approved for publication; formal legal verification deferred.** Earlier status: DRAFT. These are Kofi's business decisions, written up for review. The owner chose to publish before formal legal verification; that verification is **still outstanding**. It means a check by a Ghana-qualified lawyer, plus the current status of the Electronic Transactions Act 2008 (Act 772) and the draft Electronic Transactions Bill 2025. This document is not legal advice.

## Where the draft lives in the site (unpublished)

### Temporary business details approved for the draft

| Detail | Current draft value | Status |
|---|---|---|
| Business name | EscoWear | Owner-confirmed (30 Oct 2026) |
| Legal status | Individual-run online store; not a registered company | Owner-confirmed; registration deferred |
| Postal address | P.O. Box 1222, Mataheko, Accra, Ghana | Owner-confirmed |
| Phone | +233 50 802 5370 | Owner-confirmed |
| Support email | kofiarhin69@gmail.com | Owner confirmed on 30 Oct 2026 that it sends and receives email |
| Customer market | Ghana | Owner-approved |
| Payment | Manual Mobile Money confirmation | Receiving wallet details still required privately |
| Delivery | Confirmed individually after ordering | Replaces the earlier fixed-range estimate |

On 30 Oct 2026 the owner approved the MVP policy text and these seller details.
Formal legal verification and business registration are **deferred, not done**. The
owner confirmed the support mailbox the same day and approved publishing the MVP
policies (`emailVerified: true`, build `REACT_APP_POLICIES_STATUS=published`).

Edit `client/src/policies/review.json` to change these details. The draft page,
checkout delivery wording and policy email delivery wording read that file. Keep
`approvedForPublication: false` and `seller.emailVerified: false`; only record mailbox
verification after an owner-approved receipt-and-reply test succeeds. Reset verification
when the email address changes. No mail is routed to that address automatically.
The corresponding `.env.example` reply-to suggestion is commented out until verified.

- **Page:** `/policies`, with text in `client/src/policies/sections.js` and the switch in `client/src/policies/content.js`.
- **Switch: `ESCOWEAR_POLICIES_STATUS`** (compose; passed to the image build as `REACT_APP_POLICIES_STATUS`):
  - `hidden` (default): `/policies` says the policies are being finalised, nothing links to it, emails carry no policy promises, and **the draft text is not included in the public JavaScript at all**.
  - `draft`: full text with a red "DRAFT, not yet published" banner. For local or lawyer review only; never deploy this publicly.
  - `published`: full text, a link from the checkout agreement and the footer, policy lines in the order-received and payment emails, and orders record the policy version (`POLICY_VERSION`).
- **Applies in every state:**
  - The quote-expiry rule in the payment email ("ask for an updated quote before paying").
  - The MoMo wording ("send the exact amount… use your order number as the reference").
  - The 48-hour default expiry in the admin quote form.
- **Switch to `published` only after:** the legal review is complete, seller details are final, the support mailbox is verified, and Kofi approves. Record these facts and a final policy version in `client/src/policies/review.json`; the production build rejects missing details, placeholder values and an unverified mailbox. The approval flag is a record of the owner's decision, not an automatic legal assessment.

## Decisions recorded

| # | Topic | Decision | Date |
|---|---|---|---|
| D2 | Payment method | **Mobile Money only** for the MVP. The customer sends the exact GHS amount to one MoMo number, uses the order number as the reference, and replies to the email with a screenshot. Payment is confirmed only after the money is seen in the account. MoMo details live only in the private server setting. | 22 Oct 2026 |
| D3 | Email | Gmail SMTP from the owner's Gmail account (see `email-setup.md`). | 22 Oct 2026 |
| D4 | Admin | One admin account, the owner's (address kept in Linear IDE-125, not in this repo). | 22 Oct 2026 |
| D5a | Item unavailable after payment | Offer an alternative item first. If the customer declines, give a **full refund to the original Mobile Money number within 7 days**. | 23 Oct 2026 |
| D5b | Cancellation | Draft below; agreed in principle and pending legal verification. | 23 Oct 2026 |
| D5d | Pricing | **All-inclusive GHS quote**: shoes, shipping, import duties, taxes and delivery. **Nothing extra is paid on arrival**; EscoWear absorbs any small difference in duties. | 23 Oct 2026 |
| D5e | Delivery time | **Confirmed individually after ordering.** Supersedes the earlier fixed-range estimate. The method and timing of obtaining agreement to each order's delivery terms still need review. | 24 Oct 2026 |
| D7 | Seller identity | **Not registered as a business. Kofi trades in his own name** (sole trader) under the name "EscoWear". Kofi **lives in the UK, regularly alternates between the UK and Ghana, and manages EscoWear from both countries**, selling mainly to customers in Ghana. | 23 Oct 2026 |
| D6 | Data retention | Orders and payment records: **6 years**, then deleted. Tracking codes: deleted **within 1 day** of expiry (automatic). Customers can **request account deletion** at any time; only legally required order records are kept. Payment screenshots (Gmail inbox) are **deleted once the order is completed, unless needed for a dispute**. | 23 Oct 2026 |
| D8 | Quote validity | GHS quotes are **valid for 48 hours**, with the expiry shown in **Ghana time**. After that, the customer **must request an updated quote before paying**. | 23 Oct 2026 |
| D5c | Faulty, damaged or wrong items | Draft below: replacement or full refund; **EscoWear covers return costs**. | 23 Oct 2026 |

## Cancellation (draft wording)

1. **Before you pay:** you can cancel at any time, free of charge. Reply to our email, or simply don't pay.
2. **After you pay, before we buy your item:** you can cancel for a full refund to your Mobile Money number within 7 days.
3. **After we buy your item:** the order can't be stopped while it is on its way. You can still cancel **within 14 days of receiving it**, without giving a reason, by returning the item unworn, in its original condition and box. You pay only the direct cost of sending it back. We refund the full price within 14 days of receiving the return.
4. **Faulty or wrong items:** see below.

## Pricing (draft wording)

Prices on the site are an estimate in GBP. Before you pay, we email your **final price in Ghana cedis (GHS)**. It covers the shoes, shipping, import duties, taxes and delivery to your address. **You won't pay anything extra on arrival.**

_Implementation note: the payment-instructions email and the checkout/confirmation text must say this when the policies are published._

## Quotes (draft wording)

Your GHS quote is **valid for 48 hours**. The expiry date and time (Ghana time) are shown in our email. If it expires before you pay, **please ask us for an updated quote before paying**. Prices and exchange rates can change.

_Implementation notes:_
- _The payment email already shows the expiry in Ghana time (Africa/Accra)._
- _Implemented locally: the admin quote expiry defaults to 48 hours, and the email asks for a renewed quote before paying after expiry._

## Delivery (draft wording)

Delivery is **confirmed individually after ordering**. If anything delays your order, we'll email you with an update. You can see progress any time at /track-order. A fixed delivery window is not promised by this draft.

## Your data (draft wording, for the privacy notice)

- We keep your order and payment records for **6 years** after your order, for tax, accounting and disputes. Then we delete them.
- One-time tracking codes are deleted automatically within a day of expiring. We never store your codes in readable form.
- You can ask us to **delete your account** at any time by replying to any order email. We'll delete your account details and keep only the order records the law requires.
- Payment screenshots you upload are **stored privately**, seen only by us, and kept with your order's payment records.
  _(Corrected 30 Oct 2026: screenshots are now uploaded on the site and no automatic deletion exists; retention is still an open decision.)_

_Implementation notes (not yet built):_
- _Account deletion is a manual admin step for the MVP; no self-service button yet._
- _The 6-year deletion has no automatic job yet and needs a yearly manual review or a scheduled clean-up._
- _Screenshot deletion is done by hand in the Gmail inbox._

## Faulty, damaged or wrong items (draft wording)

1. If your item arrives faulty or damaged, or is not what you ordered (wrong size or model), tell us **within 14 days of delivery**. Reply to any order email with photos of the item and its box.
2. You choose a **replacement** (if available) or a **full refund**, including the original delivery cost, to your Mobile Money number.
3. **EscoWear pays the return costs.** Where sending the item back isn't practical, we may refund on the photo evidence alone.
4. We refund within 14 days of receiving the returned item, or of accepting the photo evidence.

## Legal points to verify before publishing

From Act 772 (official copy: Cyber Security Authority, <https://www.csa.gov.gh/resources/Electronic%20Transactions%20Act.pdf>), read on 23 Oct 2026:

- **Cooling-off:** a consumer may cancel a transaction for goods "within fourteen days after the date of the receipt of the goods … without reason and without penalty". The only charge allowed is "the direct cost of returning the goods".
  - Exceptions include goods "made to the consumer's specification", goods that "by reason of their nature cannot be returned", and perishables.
  - Ordinary sneakers sourced to order are probably **not** covered by these exceptions. Confirm.
- **Unavailable goods:** the supplier must notify the consumer immediately and "refund any payment within seven days after the date of notification". D5a fits this.
- **Performance:** execute the order within **14 days** of receiving it "unless the parties have agreed otherwise". Our sourcing and shipping times must be stated and agreed at checkout, or the contract may become voidable.
- **Information the site must show:**
  - Full name and legal status, physical address and telephone, website and email.
  - Registration details, if a company.
  - The full price including transport, taxes and other fees.
  - Payment method; delivery time; return, exchange and refund policy; privacy and security policy.
  - Terms the customer can read and store, and a chance to correct errors before ordering.
  - If these are missing, the customer may cancel within 14 days and must be refunded within 30 days.
- **Delivery wording:** review whether confirming delivery individually after ordering supplies enough information at the required stage. Specify how the customer receives and agrees to each order's delivery terms before publication; the temporary placeholder alone does not settle this question.
- **Seller identity and business name:** EscoWear is unregistered, and Kofi trades in his own name. Confirm:
  - Whether trading under the name "EscoWear" requires business-name registration (in Ghana, with the Office of the Registrar of Companies; or the equivalent where Kofi trades).
  - What identity details the site must show in that case: name, legal status, physical address and phone.
- **Cross-border setup (UK resident, operating from both the UK and Ghana, customers mainly in Ghana).** Review which rules apply, and to what extent:
  - **UK consumer law:** whether the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013 and the Consumer Rights Act 2015 apply to a UK-resident trader selling to consumers in Ghana. If they do, they bring a 14-day cancellation right, pre-contract information duties and a 14-day refund deadline.
  - **UK business-name disclosure:** a sole trader using a name other than their own (here "EscoWear") may have to show their own name and a UK address for documents on the site and in emails (Companies Act 2006, Part 41).
  - **Ghana:** business-name registration for trading as "EscoWear", and whether operating partly from Ghana creates a local registration or tax presence.
  - **Data protection:** the UK GDPR and Data Protection Act 2018 (including whether an ICO data protection fee is due), and Ghana's Data Protection Act, 2012 (Act 843), including whether registration with the Data Protection Commission is required.
  - **Tax:** UK self-assessment for trading income, and any Ghana tax position. This is for an accountant, not the site.
  - **Which country's law the terms name**, and whether a UK or Ghana lawyer (or both) should review.
- **Data retention (D6):** confirm that 6 years for order and payment records is appropriate under the UK GDPR / DPA 2018 and Ghana's Act 843, and what privacy-notice content each requires (purpose, legal basis, retention, rights, contact, international transfers). Customer data is stored in MongoDB Atlas and processed via Gmail.
- **Faulty goods:** check the buyer's rights under Ghana's general sale-of-goods law (Sale of Goods Act, 1962 (Act 137)), and whether a 14-day reporting window is acceptable or must be longer.
- To confirm:
  - Is Act 772 still in force, or replaced by the 2025 Bill?
  - Does UK consumer law also apply? This depends on where EscoWear is legally based.
  - Is requiring "unworn, original condition" acceptable under the "without penalty" rule?
  - Is the 14-day refund timing acceptable?

## Open questions (to be decided)

- Seller details were confirmed on 30 Oct 2026 (see the table above). The support mailbox kofiarhin69@gmail.com was owner-confirmed on 30 Oct 2026; legal review of seller identification for an unregistered, individual-run store is deferred.
- Privacy notice: the local draft now identifies database/email/delivery processing; applicable rights and complaint routes, legal basis, storage countries and international transfers still need review before publication. Confirm manual deletion procedures are practical before promising them.
