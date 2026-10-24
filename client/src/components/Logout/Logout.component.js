import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const Logout = ({ setIsLoggedIn }) => {
  const navigate = useNavigate();
  useEffect(() => {
    localStorage.removeItem("user");
    setIsLoggedIn(null);
    navigate("/login");
  }, [navigate, setIsLoggedIn]);
  return (
    <div>
      <h1 className="title">Logout</h1>
    </div>
  );
};

export default Logout;
