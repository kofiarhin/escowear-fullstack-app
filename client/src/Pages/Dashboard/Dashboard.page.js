import { Navigate } from "react-router-dom";

// The customer dashboard moved to /account; keep old bookmarks working.
const DashBoard = () => <Navigate to="/account" replace />;

export default DashBoard;
