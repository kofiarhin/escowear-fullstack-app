# Escowear | MVP PRD

## Product Requirements Document

Draft v1.0 | 17 October 2026 | Planning only — not implemented or approved for production

Document basis: Escowear decisions in this conversation; GitHub repository structure inspected on 17 October 2026. Proposed functionality is not a claim of implementation.

## 01 Purpose
Escowear helps customers in Ghana buy authentic sneakers curated from trusted UK retailers. Customers pay Escowear in Ghanaian cedis; Escowear buys the selected sneakers after payment, arranges international shipping and customs, and delivers to the customer in Ghana.

## 02 Problem
Buying original sneakers directly from UK retailers can be difficult for Ghana-based customers because of payment, international delivery, import costs and uncertainty. Some customers settle for counterfeit products.

## 03 Positioning
A Ghana-first, curated, made-to-order sneaker storefront. Escowear is the merchant customers pay and contact for order support; supplier purchases and fulfilment are handled manually for MVP.

## 04 Target users
Primary: Ghana-based customers seeking authentic lifestyle and running sneakers. Secondary: Escowear operator/admin responsible for product curation, UK retailer purchasing, shipping and refunds.

## 05 Business outcome
Prove that Ghana-based buyers can browse, pay in GHS, and receive authentic sneakers sourced from UK retailers, without stocking inventory upfront.

## 06 MVP scope — customer
Home; Shop; Product Details; Cart; Checkout; Order Confirmation; Track Order. Basic registration/login and order history may be delivered as minimal account views; guest checkout is deferred unless explicitly approved.

## 07 MVP scope — admin
Products: import/review curated catalog, correct size/price/supplier URL, publish/unpublish. Orders: verify paid orders, manually record retailer purchase, create shipment, change tracking status, initiate refunds. Settings: fees, exchange-rate inputs and shipping estimates; simple control surface may be within existing admin pages.

## 08 Customer journey
1 Browse curated products → 2 select size and quantity → 3 receive server-calculated GHS total and delivery estimate → 4 enter Ghana address → 5 pay securely → 6 see confirmation → 7 Escowear verifies availability and buys from trusted UK retailer → 8 Escowear ships and provides tracking updates → 9 deliver in Ghana.

## 09 Critical pricing promise
Display full amount payable before payment, including sourcing/service margin, estimated shipping and any applicable duties/taxes. Quote must have an expiry, server-side calculation and clear disclosure. Paid customer orders should not be repriced unilaterally.

## 10 Authenticity promise
Only source from approved UK retail suppliers; preserve purchase evidence for internal use. Do not claim third-party authentication certification unless actually provided.

## 11 Sourcing approach
Made-to-order. Customer payment is verified first; operator checks supplier availability and buys manually. Product listing is not guaranteed inventory. If size/product cannot be sourced, operator offers an alternative for explicit acceptance or a full refund.

## 12 Refund policy — draft
Full refund if unavailable and no accepted substitution; full cancellation before Escowear purchases from the UK retailer; after purchase, cancellation/returns handled under disclosed policy and applicable law; wrong, damaged or inauthentic items get suitable correction, replacement or refund. Approved refunds to original payment method; target 5–10 business days, subject to provider and legal requirements.

## 13 Notifications
At minimum: payment confirmation, sourcing progress, purchased, shipped, out-for-delivery, delivered, cancellation/refund outcome. Email may be primary; SMS/WhatsApp automation is not required for MVP.

## 14 Non-goals
Automatic purchasing from suppliers; guaranteed live supplier inventory; native mobile app; AI recommendations; loyalty rewards; complex warehouse operations; automated customs integrations; multi-carrier rate optimisation.

## 15 Success criteria
A customer completes an end-to-end sandbox/test checkout; admin can source manually and publish tracking; real payment webhooks are verified and idempotent; failed sourcing is refundable; mobile UI usable; critical security/checkout tests pass. Business targets such as order conversion and delivery SLA require baseline collection, not invented figures.

## 16 Open decisions
Payment provider supporting Ghana GHS and mobile money/cards; guest checkout vs mandatory account; delivery cities/coverage and courier; customs and duty calculation model; exact fee/pricing formula; UK supplier terms; customer-facing delivery estimates; full legal review of refunds, imports, privacy and consumer rights.

## 17 Risks and launch gates
Supplier sells out after payment; GBP/GHS changes; unexpected duties and shipping charges; delayed/lost shipments; counterfeit or wrong items; refunded/duplicate payments; credential exposure. GitHub public master currently tracks a .env file: rotate affected secrets and resolve public history exposure before any launch, push of compromised history or production setup.

## 18 Phases
P0 security and product display repair; P1 browse/product/cart/quotes; P2 Ghana checkout/payments/orders; P3 manual sourcing/admin/tracking/refunds; P4 automated tests, reconciliation, legal and operational go-live review.
