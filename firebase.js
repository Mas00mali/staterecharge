// Firebase SDK import (compat version for easy use)
document.write(`
  <script src="https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/9.22.2/firebase-auth-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js"></script>
`);

// Wait until Firebase loads
setTimeout(() => {
  // ✅ Replace with your Firebase config
  const firebaseConfig = {
    apiKey: "AIzaSyBrV_cAvH8DzoT56fd-x9FxCFeT-3PnkTM",
    authDomain: "staterecharge.firebaseapp.com",
    projectId: "staterecharge",
    storageBucket: "staterecharge.firebasestorage.app",
    messagingSenderId: "551094745581",
    appId: "1:551094745581:web:47793c350d7358819fcfe4",
    measurementId: "G-4M6G9C3PLQ"
  };

  // Initialize Firebase
  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();

  // Global Object
  window._NM = {};

  // ✅ Signup Function
  window._NM.signupUser = async function(name, email, password, sponsor) {
    const userCredential = await auth.createUserWithEmailAndPassword(email, password);
    const uid = userCredential.user.uid;

    await db.collection("users").doc(uid).set({
      name: name,
      email: email,
      sponsor: sponsor || null,
      plan: "none",
      balance: 0,
      createdAt: new Date()
    });

    return userCredential.user;
  };

  // ✅ Login Function
  window._NM.loginUser = async function(email, password) {
    const userCredential = await auth.signInWithEmailAndPassword(email, password);
    return userCredential.user;
  };

  // ✅ Logout Function
  window._NM.logoutUser = async function() {
    await auth.signOut();
  };

  console.log("✅ Firebase initialized and _NM functions ready.");
}, 500);
