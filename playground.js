const { setUpDatabase } = require("./server/utils/helper");
const mongoose = require("mongoose");
const dotenv = require("dotenv").config();

mongoose.connect(process.env.MONGO_REMOTE, () => console.log("connected"));

setUpDatabase();
