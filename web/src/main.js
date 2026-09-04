import { createComponent } from "tinybubble";
import App from "./App.bub.js";
import "./style.css";

const app = document.getElementById("app");
createComponent(App).appendTo(app);