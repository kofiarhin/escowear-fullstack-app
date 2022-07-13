import "./search.styles.css";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { setSearchField } from "../../redux/actions/search.action";
import { useDispatch, useSelector } from "react-redux";

// search component
const Search = () => {
  const [search, setSearch] = useState("");

  const dispatch = useDispatch();
  const navigate = useNavigate();

  const handleChange = (e) => {
    setSearch(e.target.value);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setSearch("");
    dispatch(setSearchField(search));
    if (window.location.pathname !== "/store") {
      navigate("/store");
    }
  };
  return (
    <div className="search">
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Search Product"
          value={search}
          onChange={(e) => handleChange(e)}
        />
      </form>
    </div>
  );
};

export default Search;
