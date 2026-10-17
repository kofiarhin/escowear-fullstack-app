import "./search.styles.css";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { setSearchField } from "../../redux/actions/search.action";
import { useDispatch } from "react-redux";

// search component
const Search = ({ onSearchComplete }) => {
  const [search, setSearch] = useState("");

  const dispatch = useDispatch();
  const navigate = useNavigate();

  const handleChange = (e) => {
    setSearch(e.target.value);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const query = search.trim();
    setSearch("");
    dispatch(setSearchField(query));
    navigate(
      query
        ? `/store?category=shoes&search=${encodeURIComponent(query)}`
        : "/store?category=shoes"
    );
    onSearchComplete?.();
  };
  return (
    <div className="search">
      <form onSubmit={handleSubmit} role="search">
        <label htmlFor="site-search">Search sneakers</label>
        <input
          id="site-search"
          type="text"
          placeholder="Search by model or brand"
          value={search}
          onChange={(e) => handleChange(e)}
        />
        <button type="submit">Search</button>
      </form>
    </div>
  );
};

export default Search;
