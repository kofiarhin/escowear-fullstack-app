import { useState, useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import OrderList from "../../components/OrderList/OrderList.component";

const DashBoard = ({ user }) => {
  const [orders, setOrders] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      navigate("/login");
    } else {
      fetch("/api/orders", {
        headers: {
          Authorization: `Bearer ${user.token}`,
        },
      })
        .then((response) => response.json())
        .then((data) => setOrders(data));
    }
  }, []);
  return (
    <div className="container">
      <h1 className="title">Hello {user.name} </h1>
      {orders.length > 0 ? (
        <div>
          <h1 className="title">Orders</h1>
          <OrderList data={orders} />
        </div>
      ) : (
        <h2 className="info">There are no orders</h2>
      )}
    </div>
  );
};

export default DashBoard;
