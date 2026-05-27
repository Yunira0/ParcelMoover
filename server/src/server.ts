import express, {Request, Response} from 'express';
import dotenv from 'dotenv';
const app = express();
dotenv.config();


app.get('/', (req: Request, res: Response) => {
  res.send('Hello, World!');
})

app.listen(process.env.PORT, () => {
  console.log('Server is running on port 3000');
});


