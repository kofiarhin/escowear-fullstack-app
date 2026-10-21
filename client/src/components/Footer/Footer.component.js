import { Link } from "react-router-dom";
import "./footer.styles.css";

const Footer = () => {
  return (
    <footer className="footer">
      <div className="footer-lead container">
        <div>
          <p className="footer-kicker">Escowear sneaker store</p>
          <h2>Keep your<br />rotation moving.</h2>
        </div>
        <Link to="/store?category=shoes" className="footer-shop">Shop sneakers <span>→</span></Link>
      </div>

      <div className="footer-grid container">
        <Link to="/" className="footer-wordmark">ESCOWEAR</Link>
        <nav aria-label="Shop links">
          <p>Shop</p>
          <Link to="/store?category=shoes">All sneakers</Link>
          <Link to="/store?category=shoes&search=air%20jordan">Air Jordan</Link>
          <Link to="/store?category=shoes&search=nike">Nike</Link>
          <Link to="/store?category=shoes&search=adidas">Adidas</Link>
        </nav>
        <nav aria-label="Explore links">
          <p>Explore</p>
          <Link to="/#latest-releases">New Releases</Link>
          <Link to="/#collections">Collections</Link>
          <Link to="/#about">About</Link>
        </nav>
        <nav aria-label="Account links">
          <p>Account</p>
          <Link to="/login">Login</Link>
          <Link to="/register">Register</Link>
          <Link to="/cart">Cart</Link>
          <Link to="/track-order">Track order</Link>
        </nav>
      </div>

      <div className="footer-bottom container">
        <p>© {new Date().getFullYear()} Escowear</p>
        <p>Premium sneaker store</p>
        <a href="#top">Back to top</a>
      </div>
    </footer>
  );
};

export default Footer;
