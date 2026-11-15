import { Link } from "react-router-dom";
import { policiesVisible } from "../../policies/content";
import "./footer.styles.css";

const Footer = () => {
  return (
    <footer className="footer">
      <div className="footer-lead container">
        <div>
          <p className="footer-kicker">Escowear sneaker store</p>
          <h2>Keep your<br />rotation moving.</h2>
        </div>
        <Link to="/store?category=shoes" className="footer-shop">Shop sneakers <span aria-hidden="true">→</span></Link>
      </div>

      <div className="footer-grid container">
        <div className="footer-brand">
          <Link to="/" className="footer-wordmark">ESCOWEAR</Link>
          <p>Authentic UK sneakers, paid for in GHS and delivered to Ghana.</p>
        </div>
        <nav aria-label="Shop links">
          <p>Shop</p>
          <ul>
            <li><Link to="/store?category=shoes">All sneakers</Link></li>
            <li><Link to="/store?category=shoes&search=air%20jordan">Air Jordan</Link></li>
            <li><Link to="/store?category=shoes&search=nike">Nike</Link></li>
            <li><Link to="/store?category=shoes&search=adidas">Adidas</Link></li>
          </ul>
        </nav>
        <nav aria-label="Explore links">
          <p>Explore</p>
          <ul>
            <li><Link to="/#latest-releases">New Releases</Link></li>
            <li><Link to="/#collections">Collections</Link></li>
            <li><Link to="/#about">About</Link></li>
          </ul>
        </nav>
        <nav aria-label="Account links">
          <p>Account</p>
          <ul>
            <li><Link to="/login">Login</Link></li>
            <li><Link to="/register">Register</Link></li>
            <li><Link to="/cart">Cart</Link></li>
            <li><Link to="/track-order">Track order</Link></li>
            {policiesVisible() && <li><Link to="/policies">Shop policies</Link></li>}
          </ul>
        </nav>
      </div>

      <div className="footer-bottom container">
        <p>© {new Date().getFullYear()} Escowear</p>
        <p>Premium sneaker store</p>
        <a href="#top">Back to top <span aria-hidden="true">↑</span></a>
      </div>
    </footer>
  );
};

export default Footer;
