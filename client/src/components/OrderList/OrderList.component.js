import { Link } from "react-router-dom";
import "./orderList.styles.css";
const OrderList = ({ data }) => {
  console.log(data);
  return (
    <div className="order-list-wrapper">
      {data.map((item, index) => {
        return (
          <div className="order-unit">
            <h2> {index + 1}. Order Details</h2>
            {item.products.map((product, index) => (
              <p>
                {" "}
                {index + 1}. {product.name}{" "}
              </p>
            ))}
            <p>Created At: {item.createdAt} </p>
            <p>Status: {item.status} </p>
          </div>
        );
      })}
    </div>
  );
};

export default OrderList;
