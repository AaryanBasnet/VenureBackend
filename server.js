require("dotenv").config();
const app = require("./index");

const PORT = process.env.PORT || 5050
app.listen(
    PORT,
    () => {
        console.log("Server running")
    }
)