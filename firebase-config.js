
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js';

// Your web app's Firebase configuration
// IMPORTANT: Replace with your actual Firebase project configuration
const firebaseConfig = {
  apiKey: "AIzaSyD1-ZhYGtJzJFY4WfSUS_lbnzLhzWfT1D8",
  authDomain: "sistemaintegrall.firebaseapp.com",
  projectId: "sistemaintegrall",
  storageBucket: "sistemaintegrall.firebasestorage.app",
  messagingSenderId: "302291844621",
  appId: "1:302291844621:web:6ebf1845790bdeabfc1f44",
  measurementId: "G-E5BT7GXRZN"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
