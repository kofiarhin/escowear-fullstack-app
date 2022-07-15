import { useState, useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import OrderList from "../../components/OrderList/OrderList.component";
import { useSelector } from "react-redux";
import "./dashboard.styles.css";

const DashBoard = () => {
  const [orders, setOrders] = useState([]);
  const navigate = useNavigate();

  const { user } = useSelector((state) => state.userReducer);

  useEffect(() => {
    if (user === null) {
      navigate("/login");
    }
  }, [user]);

  // useEffect(() => {
  //   if (!user) {
  //     navigate("/login");
  //   } else {
  //     fetch("/api/orders", {
  //       headers: {
  //         Authorization: `Bearer ${user.token}`,
  //       },
  //     })
  //       .then((response) => response.json())
  //       .then((data) => setOrders(data));
  //   }
  // }, []);
  return (
    <div className="dashboard">
      <div className="container">
        {user && (
          <>
            {" "}
            <h1 className="title">Hello {user.name} </h1>
            {orders.length > 0 ? (
              <div>
                <h1 className="title">Orders</h1>
                <OrderList data={orders} />
              </div>
            ) : (
              <h2 className="info">There are no orders</h2>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default DashBoard;
