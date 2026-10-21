import { formatGBP } from "../../utils/money";
import "./orderItems.styles.css";

// Read-only list of an order's item snapshots with the indicative GBP subtotal.
const OrderItems = ({ order }) => (
  <section className="order-items" aria-label="Items in this order">
    <ul>
      {order.items.map((item, index) => (
        <li key={`${item.productId || index}:${item.size}`}>
          {item.image && <img src={item.image} alt="" />}
          <div>
            <p className="order-items-name">{item.name}</p>
            <p>
              {item.size} · Qty {item.quantity}
            </p>
          </div>
          {Number.isInteger(item.lineTotalGBPMinor) && <p className="order-items-price">{formatGBP(item.lineTotalGBPMinor)}</p>}
        </li>
      ))}
    </ul>
    {order.pricing && (
      <dl>
        <div>
          <dt>Indicative subtotal (GBP estimate)</dt>
          <dd>{formatGBP(order.pricing.subtotalGBPMinor)}</dd>
        </div>
      </dl>
    )}
  </section>
);

export default OrderItems;
