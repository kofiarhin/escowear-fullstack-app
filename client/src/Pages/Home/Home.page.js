import "./home.styles.css";
import Categories from "../../components/Categories/Categories.component";
const Home = () => {
  return (
    <div className="home">
      <div className="container">
        <div
          className="banner"
          style={{
            height: "80vh",
            backgroundImage: "url(/images/banner.jpg)",
            backgroundSize: "cover",
          }}
        ></div>
      </div>
      {/* end container */}
    </div>
  );
};

export default Home;
