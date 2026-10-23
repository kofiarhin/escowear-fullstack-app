# EscoWear MVP policies — DRAFT

> **Status: DRAFT, not published.** These are Kofi's business decisions, written up for review. **The Ghana legal requirements must be verified before anything is published or shown to customers.** That means a check by a Ghana-qualified lawyer, plus the current status of the Electronic Transactions Act 2008 (Act 772) and the draft Electronic Transactions Bill 2025. This document is not legal advice.

## Decisions recorded

| # | Topic | Decision | Date |
|---|---|---|---|
| D2 | Payment method | **Mobile Money only** for the MVP. The customer sends the exact GHS amount to one MoMo number, uses the order number as the reference, and replies to the email with a screenshot. Payment is confirmed only after the money is seen in the account. MoMo details live only in the private server setting. | 22 Oct 2026 |
| D3 | Email | Gmail SMTP from `kofiarhin69@gmail.com` (see `email-setup.md`). | 22 Oct 2026 |
| D4 | Admin | One admin account: `kofiarhin69@gmail.com`. | 22 Oct 2026 |
| D5a | Item unavailable after payment | Offer an alternative item first. If the customer declines, give a **full refund to the original Mobile Money number within 7 days**. | 23 Oct 2026 |
| D5b | Cancellation | Draft below; agreed in principle and pending legal verification. | 23 Oct 2026 |
| D5d | Pricing | **All-inclusive GHS quote**: shoes, shipping, import duties, taxes and delivery. **Nothing extra is paid on arrival**; EscoWear absorbs any small difference in duties. | 23 Oct 2026 |
| D5e | Delivery time | **Estimate, not a guarantee: usually 10–21 days**, counted from when we confirm your payment. Customers are emailed about any delay. **The estimate must be verified against real UK-to-Ghana shipping times before publishing.** | 23 Oct 2026 |
| D5c | Faulty, damaged or wrong items | Draft below: replacement or full refund; **EscoWear covers return costs**. | 23 Oct 2026 |

## Cancellation (draft wording)

1. **Before you pay:** you can cancel at any time, free of charge. Reply to our email, or simply don't pay.
2. **After you pay, before we buy your item:** you can cancel for a full refund to your Mobile Money number within 7 days.
3. **After we buy your item:** the order can't be stopped while it is on its way. You can still cancel **within 14 days of receiving it**, without giving a reason, by returning the item unworn, in its original condition and box. You pay only the direct cost of sending it back. We refund the full price within 14 days of receiving the return.
4. **Faulty or wrong items:** see below.

## Pricing (draft wording)

Prices on the site are an estimate in GBP. Before you pay, we email your **final price in Ghana cedis (GHS)**. It covers the shoes, shipping, import duties, taxes and delivery to your address. **You won't pay anything extra on arrival.**

_Implementation note: the payment-instructions email and the checkout/confirmation text must say this when the policies are published._

## Delivery (draft wording)

Delivery usually takes **10–21 days, counted from when we confirm your payment**. This is an estimate, not a guarantee. If anything delays your order, we'll email you with an update. You can see progress any time at /track-order.

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
- **Delivery wording:** Act 772 requires an order to be executed within 14 days "unless the parties have agreed otherwise". Confirm that a stated 10–21 day *estimate* accepted with the quote counts as "agreed otherwise". If not, it may need to be a firm maximum period. Also verify the 10–21 day range against real shipping times.
- **Faulty goods:** check the buyer's rights under Ghana's general sale-of-goods law (Sale of Goods Act, 1962 (Act 137)), and whether a 14-day reporting window is acceptable or must be longer.
- To confirm:
  - Is Act 772 still in force, or replaced by the 2025 Bill?
  - Does UK consumer law also apply? This depends on where EscoWear is legally based.
  - Is requiring "unworn, original condition" acceptable under the "without penalty" rule?
  - Is the 14-day refund timing acceptable?

## Open questions (to be decided)

- Quote validity period.
- Business identity details for the site (legal name and status, address, phone).
- Privacy notice, and how long customer data is kept (D6).
