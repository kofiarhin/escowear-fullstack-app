import { Link } from "react-router-dom";
import { formatGBP } from "../../utils/money";
import "./orderList.styles.css";

const formatDate = (value) => (value ? new Date(value).toLocaleDateString("en-GB", { dateStyle: "medium" }) : "");

const OrderList = ({ data }) => {
  return (
    <ul className="order-list-wrapper">
      {data.map((order) => (
        <li className="order-unit" key={order.id}>
          <h3>{order.orderNumber ? `Order ${order.orderNumber}` : "Earlier order"}</h3>
          <p>Placed: {formatDate(order.createdAt)}</p>
          <p>Status: {order.statusLabel || order.status}</p>
          <ul>
            {order.items.map((item, index) => (
              <li key={`${item.productId || index}:${item.size}`}>
                {item.name} {item.size ? `(${item.size})` : ""} × {item.quantity}
              </li>
            ))}
          </ul>
          {order.pricing && <p>Indicative subtotal: {formatGBP(order.pricing.subtotalGBPMinor)}</p>}
          {!order.legacy && <Link to={`/orders/${order.id}`}>View order</Link>}
        </li>
      ))}
    </ul>
  );
};

export default OrderList;
