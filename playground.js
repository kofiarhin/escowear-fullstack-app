const { setUpDatabase } = require("./server/utils/helper");
const mongoose = require("mongoose");
const connect = mongoose.connect("mongodb://localhost:27017/escowear");

setUpDatabase();
