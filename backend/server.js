import express from "express";
import uploadRoutes from "./src/routes.js";
import cors from "cors";
import "dotenv/config";   // add this line on top


const app = express();
app.use(cors());   
app.use(express.json());
app.use("/upload", uploadRoutes);

app.listen(process.env.PORT, () =>
  console.log(`Backend running on ${process.env.PORT} 🚀`)
);

