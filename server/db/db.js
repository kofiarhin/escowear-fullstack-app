const { default: mongoose } = require("mongoose");

const connect = mongoose.connect("mongodb://localhost:27017/escowear");
module.exports = connect;
