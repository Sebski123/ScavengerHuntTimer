import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
    getFunctions,
    httpsCallable,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyBD8s0hhfpPwTjI4pEvatt4ZdkQmoGU7Es",
  authDomain: "scavengerhunttimer.firebaseapp.com",
  projectId: "scavengerhunttimer",
  storageBucket: "scavengerhunttimer.firebasestorage.app",
  messagingSenderId: "335882140634",
  appId: "1:335882140634:web:52293c005f49dcf8305ee3",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const functions = getFunctions(app, "europe-west1");
export const callGame = httpsCallable(functions, "game");
export const callOrganizerOverview = httpsCallable(
  functions,
  "organizerOverview"
);
