import "dotenv/config";
import app from "./server";
import { verifyMailer } from "./lib/mailer";
import {generateTrackingId} from "./utils/trackingId"

const port = process.env.PORT || 3000;

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    console.log(generateTrackingId());
    verifyMailer();
});