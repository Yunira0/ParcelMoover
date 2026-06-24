import "dotenv/config";
import app from "./server";

import {getDatePart, randomBase32, getCheckDigit, generateTrackingId} from "./utils/trackingId"
const port = process.env.PORT || 3000;


app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    console.log(generateTrackingId())
});