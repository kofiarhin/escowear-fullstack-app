import { Navigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { defaultLandingPath } from "../../utils/authRedirect";

// Old bookmarks to /dashboard land on the right home for the signed-in role:
// admins on /admin, customers on /account. Signed-out visitors log in first
// and come back here, which then forwards them by role.
const DashBoard = () => {
  const { user } = useSelector((state) => state.userReducer);
  if (!user) return <Navigate to="/login" replace state={{ from: "/dashboard" }} />;
  return <Navigate to={defaultLandingPath(user)} replace />;
};

export default DashBoard;
