# EscoWear — Manual Mobile Money Order Flow

**Status:** Owner-selected MVP payment workflow; documentation of the intended experience, **not an implementation or production approval**.
**Recorded:** 27 October 2026
**Related:** [MVP PRD](escowear-mvp-prd.md), [technical spec](escowear-mvp-technical-spec.md), [existing manual-checkout implementation](manual-checkout-implementation.md), Linear IDE-126.

## Goal

Customers in Ghana order authentic sneakers sourced manually from approved UK retailers. They pay EscoWear directly by **Mobile Money**, submit a screenshot and transaction reference, and an admin verifies **actual receipt of funds** before sourcing and shipping the shoes.

**No automated Mobile Money gateway is needed for this MVP flow.** A payment screenshot is never sufficient evidence on its own.

## Customer journey

1. **Browse.** Choose shoes, size and quantity; add to cart.
2. **Checkout.** Enter name, email, Ghana phone and delivery address. Show a final price in GHS, delivery cost (paid by the customer), included import/customs charges, and estimated delivery date **before payment**. The agreed total is not raised after ordering. Show order number and quote/payment validity.
3. **Payment instructions.** Display the configured EscoWear Mobile Money recipient number/account name, the exact GHS amount, and an order reference. Payment details must be configured privately; never hardcode real payment credentials into the public repository.
4. **Pay externally.** Customer uses their Mobile Money app/USSD to transfer the exact amount.
5. **Submit proof on the website — proposed change.** Customer enters the Mobile Money transaction reference and uploads a payment screenshot linked to the correct order. Clearly say **“Payment submitted for review — not confirmed.”** Prevent duplicate submissions and unauthorized access to other orders. Validate file type/size and securely store/restrict access to images because receipts contain personal financial details.
6. **Admin reviews.** Admin sees the order, quoted amount, submitted reference and screenshot; independently checks the actual Mobile Money account's received transactions, amount and reference. Record verifier, time and verified reference; reject or flag missing/mismatched/unreceived transfers. **Do not accept a screenshot as proof that money arrived.**
7. **Only after funds are verified:** Mark payment as confirmed, notify the customer, check UK supplier availability for the exact shoes/size, and buy from an approved retailer. Record purchase details.
8. **Fulfil.** Arrange international shipping/customs and local Ghana delivery; update the customer as the order progresses and provide a tracking reference when available.
9. **Complete.** Mark delivered/completed after delivery confirmation.

## Main order and payment states

- Order placed / awaiting quote or payment instructions.
- **Awaiting Mobile Money payment** — no sourcing.
- **Payment proof submitted / under review** — no sourcing.
- **Payment issue** — admin requests correction or investigates; no sourcing.
- **Payment verified** — admin has checked real receipt of funds. Sourcing may start.
- **Processing / UK retailer purchased** — admin sources and purchases manually.
- **Dispatched / in transit / delivered / completed** — customer receives updates.

Implementation should use the existing order/payment status model where possible rather than introduce incompatible status names.

## Exceptions and customer care

- **No payment / invalid or mismatched proof:** keep order on hold, tell customer what is missing, never purchase the shoes until payment is independently verified.
- **Item or requested size unavailable after payment:** offer an alternative for the customer's explicit acceptance, otherwise refund in line with the recorded policy.
- **Wrong shoes:** provide a free replacement; EscoWear pays return delivery.
- **Damaged shoes:** customer chooses a free replacement or a full refund; EscoWear pays return delivery.
- **Delivery delay:** notify the customer and update the estimate.
- **Refund/cancellation:** follow approved written terms and applicable consumer law; refund execution and confirmation are tracked by an admin.

## Customer-facing screens

- Cart and checkout with item/size/quantity, Ghana address and fully disclosed GHS total.
- Pending order/quote and Mobile Money instructions (actual recipient details privately configured).
- **Proposed new proof submission:** transaction-reference field, screenshot upload and status message.
- Order confirmation and progress/tracking page, with verified updates only.
- Notifications for payment confirmation, sourcing progress, dispatch, delays and completion.

## Admin controls

- Secure order list and detail page, including submitted proof and transaction reference.
- Explicit **Verify payment** action requiring confirmation from the real Mobile Money transaction history, not the screenshot.
- Payment issue/rejection and contact-customer action.
- Record retailer purchase, shipment, tracking updates, delivery and manual refunds.
- Audit each action; restrict receipt images and financial references to authorized admins; avoid duplicate verification/refunds.

## Relationship to current GitHub implementation

As documented in [manual-checkout-implementation.md](manual-checkout-implementation.md), **existing code uses a different first-stage workflow**: a customer submits a guest order request without paying, an admin manually sends a GHS quote and Mobile Money instructions by email, and the customer sends a screenshot **by email**. The admin marks it under review and verifies an actual receipt. **There is currently no website screenshot-upload feature.**

This document records the **desired website-upload experience**, not a claim that the current frontend/backend implements it. Before implementing, reconcile when the final GHS quote is issued, the existing admin email workflow and order state machine. The checkout account decision is **not approved by this document**; the existing implementation already supports guest order requests.

## Decisions already recorded

- Ghana-first customer market; UK-sourced, made-to-order sneakers; GHS prices.
- Manual Mobile Money transfer and **admin verification before sourcing**.
- Customer pays normal delivery; show it before paying.
- Show estimated delivery date and notify of delays.
- Include applicable import/customs charges in the displayed price.
- Honour the agreed checkout total; no later price increase.
- Customer-facing name **EscoWear**. The business is **not yet registered**; do not invent a registered legal identity.

## Open work / release boundaries

- Build and test authenticated/authorized proof upload, private receipt storage, anti-duplication, admin verification and end-to-end flow. **Not yet implemented.**
- Confirm actual Mobile Money recipient details, payment references, quote issuance/expiry, delivery partners/coverage, customer communications and retention of uploaded receipts.
- Confirm seller legal identity/contact details and legally review Ghana customer/refund/privacy policies. Do not publish unfinished policies.
- Exposed MongoDB production credential rotation (Linear IDE-123) is deferred by owner until project completion but remains an **unresolved security risk**. **Do not enable real production checkout or collect customer data until launch risks and approvals are resolved.**
- No merge, production deployment or launch is authorized by this document.
