import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyALgMHYx6nEcg_bE1rputUqIrfOqd1uf7I",
  authDomain: "evil-claude.firebaseapp.com",
  projectId: "evil-claude",
  storageBucket: "evil-claude.firebasestorage.app",
  messagingSenderId: "328908391597",
  appId: "1:328908391597:web:f6520de020b3f10abdf224"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
