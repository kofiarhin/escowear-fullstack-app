import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import OrderList from "../../components/OrderList/OrderList.component";
import { useDispatch, useSelector } from "react-redux";
import { logoutUser } from "../../redux/actions/user.action";
import { apiRequest, authHeader } from "../../utils/api";
import "./dashboard.styles.css";

const DashBoard = () => {
  const [orders, setOrders] = useState([]);
  const [state, setState] = useState("loading");
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const { user } = useSelector((state) => state.userReducer);

  useEffect(() => {
    if (user === null) {
      navigate("/login");
    }
  }, [user, navigate]);

  // Only the signed-in customer's own orders are returned by the API.
  useEffect(() => {
    if (!user?.token) return undefined;
    let active = true;
    apiRequest("/api/orders", { headers: authHeader(user) })
      .then(({ ok, status, data }) => {
        if (!active) return;
        // Expired sign-in: sign out (the effect above then redirects to login).
        if (status === 401) {
          dispatch(logoutUser());
          return;
        }
        if (ok && Array.isArray(data?.items)) {
          setOrders(data.items);
          setState("ready");
        } else setState("error");
      })
      .catch(() => active && setState("error"));
    return () => {
      active = false;
    };
  }, [user, dispatch]);

  return (
    <div className="dashboard">
      <div className="container">
        {user && (
          <>
            <h1 className="title">Hello {user.name} </h1>
            {state === "loading" && <p role="status">Loading your orders…</p>}
            {state === "error" && <p role="alert">Your orders could not be loaded. Please try again later.</p>}
            {state === "ready" &&
              (orders.length > 0 ? (
                <div>
                  <h2 className="title">Orders</h2>
                  <OrderList data={orders} />
                </div>
              ) : (
                <h2 className="info">There are no orders</h2>
              ))}
          </>
        )}
      </div>
    </div>
  );
};

export default DashBoard;
