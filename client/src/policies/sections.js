// Draft policy text (see content.js). Only bundled when
// REACT_APP_POLICIES_STATUS is "draft" or "published".
import review from "./review.json";

const { business, seller } = review;
export const POLICY_SECTIONS = [
  {
    id: "how-ordering-works",
    title: "How ordering works",
    paragraphs: [
      `Placing an order on ${business.name} sends us an order request. You are not charged when you place it.`,
      `We serve customers in ${business.customerMarket}.`,
      "We check that your exact size is available from the UK retailer and work out your final price. We then email you a quote in Ghana cedis (GHS) with payment instructions.",
      "Your order is confirmed only after we have checked that your payment has arrived in our account.",
    ],
  },
  {
    id: "pricing-and-quotes",
    title: "Prices and quotes",
    paragraphs: [
      "Prices on the website are estimates in British pounds (GBP).",
      "Your final GHS quote includes everything: the shoes, shipping, import duties, taxes and delivery to your address. You will not pay anything extra on arrival.",
      "Each quote is valid for 48 hours. The expiry date and time (Ghana time) are shown in our email. If your quote has expired, please ask us for an updated quote before paying, because prices and exchange rates can change.",
    ],
  },
  {
    id: "payment",
    title: "Payment",
    paragraphs: [
      `Payment method: ${business.payment}.`,
      "We accept Mobile Money only. Send the exact amount in your quote to the Mobile Money number in our email, using your order number as the payment reference.",
      "After paying, reply to our email with a screenshot of your payment. We confirm your order once we have seen the money arrive in our account. A screenshot on its own is not proof of payment.",
    ],
  },
  {
    id: "delivery",
    title: "Delivery",
    paragraphs: [
      business.delivery,
      "If anything delays your order, we will email you. You can check your order's progress at any time on the Track order page.",
    ],
  },
  {
    id: "unavailable-items",
    title: "If your item becomes unavailable",
    paragraphs: [
      "If we cannot get your item after you have paid, we will tell you straight away and offer an alternative item.",
      "If you would rather not take the alternative, we will give you a full refund to the Mobile Money number you paid from within 7 days.",
    ],
  },
  {
    id: "cancellation",
    title: "Cancelling your order",
    list: [
      "Before you pay: you can cancel at any time, free of charge. Reply to our email, or simply don't pay.",
      "After you pay, before we buy your item: you can cancel and receive a full refund to your Mobile Money number within 7 days.",
      "After we buy your item: your order cannot be stopped while it is on its way. You can still cancel within 14 days of receiving it, without giving a reason, by returning the item unworn, in its original condition and box. You pay only the direct cost of sending it back, and we refund the full price within 14 days of receiving it.",
    ],
  },
  {
    id: "faulty-items",
    title: "Faulty, damaged or wrong items",
    paragraphs: [
      "If your item arrives faulty or damaged, or is not what you ordered (for example the wrong size or model), tell us within 14 days of delivery. Reply to any order email with photos of the item and its box.",
      "You can choose a replacement (if available) or a full refund, including the original delivery cost, to your Mobile Money number. EscoWear pays the cost of returning the item. Where returning it isn't practical, we may refund based on your photos.",
      "We refund within 14 days of receiving the returned item, or of accepting your photos.",
    ],
  },
  {
    id: "your-data",
    title: "Your data",
    paragraphs: [
      "We use your name, email, phone number and delivery address only to process, deliver and support your order and to contact you about it.",
      "Our website and database providers (including MongoDB Atlas), email provider (Gmail) and delivery partners process the details needed to provide these services. Payment details are also processed by your Mobile Money provider.",
      "We keep order and payment records for 6 years after your order, for tax, accounting and disputes, and then delete them.",
      "One-time tracking codes are deleted automatically within a day of expiring.",
      "You can ask us to delete your account at any time by replying to any order email. We will keep only the order records the law requires.",
      "Payment screenshots you email us are deleted once your order is completed, unless we need them to resolve a dispute.",
    ],
  },
  {
    id: "contact",
    title: "Contact and seller details",
    paragraphs: [
      "Questions about an order? Reply to any of our order emails.",
      `Business name: ${business.name}.`,
      `Seller name: ${seller.name || "To be confirmed"}. Legal status: ${seller.legalStatus || "To be confirmed"}.`,
      `Business address: ${seller.address || "To be confirmed"}.`,
      `Support email: ${seller.email || "To be confirmed"}${seller.emailVerified ? "" : " — UNVERIFIED; mailbox testing is pending"}.`,
      `Phone: ${seller.phone || "To be confirmed"}.`,
    ],
    pendingLegalReview: true,
  },
];
