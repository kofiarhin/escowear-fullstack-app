import "./home.styles.css";
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
    </div>
  );
};

export default Home;
