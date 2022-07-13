import { Link } from "react-router-dom";
import "./footer.styles.css";
const Footer = () => {
  return (
    <div className="footer">
      <div className="footer-wrapper">
        <div className="footer-unit">
          <div className="socials">
            <i className="fa fa-facebook"></i>
            <i className="fa fa-instagram"></i>
            <i className="fa fa-twitter"></i>
            <i className="fa fa-linkedin"></i>
          </div>
        </div>
      </div>

      <div className="container">
        <p className="slug">
          Lorem ipsum dolor sit amet consectetur adipisicing elit. Dolorum
          dignissimos, est error hic minus esse maiores magnam odio voluptatem
          sequi.
        </p>
      </div>
    </div>
  );
};
export default Footer;
