<!-- auth.html (Signup / Login Page) -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>User Authentication</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background: #f2f2f2;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
    }
    .box {
      background: white;
      padding: 20px;
      border-radius: 10px;
      box-shadow: 0px 4px 10px rgba(0,0,0,0.1);
      width: 300px;
      text-align: center;
    }
    input {
      width: 90%;
      margin: 10px 0;
      padding: 10px;
      border: 1px solid #ccc;
      border-radius: 5px;
    }
    button {
      padding: 10px;
      margin: 10px 0;
      width: 95%;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      background: blue;
      color: white;
      font-size: 16px;
    }
  </style>
</head>
<body>
  <div class="box">
    <h2>Signup</h2>
    <input type="email" id="signupEmail" placeholder="Enter Email">
    <input type="password" id="signupPassword" placeholder="Enter Password">
    <button onclick="signupUser()">Signup</button>

    <h2>Login</h2>
    <input type="email" id="loginEmail" placeholder="Enter Email">
    <input type="password" id="loginPassword" placeholder="Enter Password">
    <button onclick="loginUser()">Login</button>

    <button onclick="logoutUser()" style="background:red;">Logout</button>
  </div>

  <!-- Firebase SDK -->
  <script type="module">
    // Firebase import
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
    import { 
      getAuth, 
      createUserWithEmailAndPassword, 
      signInWithEmailAndPassword,
      signOut 
    } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

    // Your Firebase Config
    const firebaseConfig = {
      apiKey: "Kkh12x0385alZA9HlGCrWm6dYnS2",  // <-- aap yaha apna API Key daalo
      authDomain: "your-app.firebaseapp.com",
      projectId: "your-app",
      storageBucket: "your-app.appspot.com",
      messagingSenderId: "1234567890",
      appId: "1:1234567890:web:abcdef"
    };

    // Initialize Firebase
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);

    // SIGNUP Function
    window.signupUser = function() {
      const email = document.getElementById("signupEmail").value;
      const password = document.getElementById("signupPassword").value;

      createUserWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
          alert("Signup Successful ✅");
          console.log(userCredential.user);
        })
        .catch((error) => {
          alert(error.message);
        });
    }

    // LOGIN Function
    window.loginUser = function() {
      const email = document.getElementById("loginEmail").value;
      const password = document.getElementById("loginPassword").value;

      signInWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
          alert("Login Successful ✅");
          console.log(userCredential.user);
          window.location.href = "dashboard.html"; // redirect after login
        })
        .catch((error) => {
          alert(error.message);
        });
    }

    // LOGOUT Function
    window.logoutUser = function() {
      signOut(auth).then(() => {
        alert("Logged out ❌");
      }).catch((error) => {
        alert(error.message);
      });
    }
  </script>
</body>
</html>
