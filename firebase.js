// firebase.js
// Include these script tags BEFORE this file in each HTML:
// <script src="https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js"></script>
// <script src="https://www.gstatic.com/firebasejs/9.22.2/firebase-auth-compat.js"></script>
// <script src="https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js"></script>
// <script src="https://www.gstatic.com/firebasejs/9.22.2/firebase-storage-compat.js"></script>

const firebaseConfig = {
  apiKey: "REPLACE_WITH_YOUR_API_KEY",
  authDomain: "REPLACE_WITH_YOUR_PROJECT.firebaseapp.com",
  projectId: "REPLACE_WITH_YOUR_PROJECT",
  storageBucket: "REPLACE_WITH_YOUR_PROJECT.appspot.com",
  messagingSenderId: "REPLACE_SENDER_ID",
  appId: "REPLACE_APP_ID",
  measurementId: "REPLACE_MEASUREMENT_ID"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// ---------- Helpers ----------
function showMsg(id, text){ const el = document.getElementById(id); if(el) el.innerText = text; }
function redirectIfLoggedIn(to = 'dashboard.html'){ auth.onAuthStateChanged(user => { if(user) window.location = to; }); }
function protectPage(){ auth.onAuthStateChanged(user => { if(!user) window.location = 'index.html'; }); }
function currentUserPromise(){ return new Promise((resolve)=>{ const unsub = auth.onAuthStateChanged(u=>{ unsub(); resolve(u); }); }); }
function now(){ return firebase.firestore.FieldValue.serverTimestamp(); }

// ---------- Signup / Login ----------
async function signupUser(name, email, password, sponsorCode){
  const cred = await auth.createUserWithEmailAndPassword(email, password);
  await cred.user.updateProfile({ displayName: name || '' });
  const uid = cred.user.uid;
  const referralCode = uid.slice(0,6).toUpperCase();
  await db.collection('users').doc(uid).set({
    uid,
    name: name||'',
    email,
    photoURL: null,
    sponsorCode: sponsorCode ? sponsorCode.toUpperCase() : null,
    referralCode,
    walletBalance: 0,
    plan: null,
    membership: null,
    role: 'ASSOCIATE',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  return cred.user;
}

async function loginUser(email, password){ const cred = await auth.signInWithEmailAndPassword(email, password); return cred.user; }
function logout(){ auth.signOut().then(()=> window.location = 'index.html'); }
function sendReset(email){ return auth.sendPasswordResetEmail(email); }

// ---------- Wallet / Transactions ----------
async function addTransaction(uid, type, amount, note){
  await db.collection('transactions').add({
    userId: uid,
    type, // 'CREDIT' or 'DEBIT'
    amount,
    note: note || '',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}
async function creditWallet(uid, amount, note='Admin credit'){
  amount = Number(amount);
  if(isNaN(amount) || amount <= 0) throw new Error('Invalid amount');
  const userRef = db.collection('users').doc(uid);
  await db.runTransaction(async t => {
    const snap = await t.get(userRef);
    if(!snap.exists) throw new Error('User not found');
    t.update(userRef, { walletBalance: firebase.firestore.FieldValue.increment(amount) });
    const txRef = userRef.collection('walletTransactions').doc();
    t.set(txRef, { type:'CREDIT', amount, note, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  });
  await addTransaction(uid, 'CREDIT', amount, note);
}
async function debitWallet(uid, amount, note='Admin debit'){
  amount = Number(amount);
  if(isNaN(amount) || amount <= 0) throw new Error('Invalid amount');
  const userRef = db.collection('users').doc(uid);
  await db.runTransaction(async t => {
    const snap = await t.get(userRef);
    if(!snap.exists) throw new Error('User not found');
    const bal = snap.data().walletBalance || 0;
    if(bal < amount) throw new Error('Insufficient balance');
    t.update(userRef, { walletBalance: firebase.firestore.FieldValue.increment(-amount) });
    const txRef = userRef.collection('walletTransactions').doc();
    t.set(txRef, { type:'DEBIT', amount, note, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  });
  await addTransaction(uid, 'DEBIT', amount, note);
}

// ---------- Commission Engine ----------
// base commission for Silver (599)
const BASE_COMMISSION = [100,50,25,10,5]; // levels 1..5

// find user by referral code
async function findUserByReferralCode(code){
  if(!code) return null;
  const q = await db.collection('users').where('referralCode','==', code.toUpperCase()).limit(1).get();
  if(q.empty) return null;
  const d = q.docs[0];
  return { uid: d.id, data: d.data() };
}

async function creditWalletAtomic(targetUid, amount, fromUserUid, reason='Commission'){
  amount = Number(amount);
  if(isNaN(amount) || amount <= 0) {
    // Allow zero? ignore credits of zero
    if(amount === 0) return;
    throw new Error('Invalid amount for credit');
  }
  const userRef = db.collection('users').doc(targetUid);
  const txCol = userRef.collection('walletTransactions');
  await db.runTransaction(async t => {
    const snap = await t.get(userRef);
    if(!snap.exists) throw new Error('User not found for credit');
    t.update(userRef, { walletBalance: firebase.firestore.FieldValue.increment(amount) });
    t.set(txCol.doc(), {
      type: 'CREDIT',
      amount,
      note: `${reason} from ${fromUserUid}`,
      from: fromUserUid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  });
  await addTransaction(targetUid, 'CREDIT', amount, `${reason} from ${fromUserUid}`);
}

async function creditAdmin(amount, fromUserUid, reason='Commission (unassigned)'){
  amount = Number(amount);
  const adminRef = db.collection('admin').doc('company');
  await db.runTransaction(async t => {
    const snap = await t.get(adminRef);
    if(!snap.exists){
      t.set(adminRef, { walletBalance: amount || 0 });
      t.set(adminRef.collection('txs').doc(), { type:'CREDIT', amount, note: reason, from: fromUserUid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    } else {
      t.update(adminRef, { walletBalance: firebase.firestore.FieldValue.increment(amount) });
      t.set(adminRef.collection('txs').doc(), { type:'CREDIT', amount, note: reason, from: fromUserUid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    }
  });
}

// distributeCommission scaled to plan amount
async function distributeCommission(buyerUid, planAmount){
  // planAmount is number (599 / 2599 / 5599)
  const buyerSnap = await db.collection('users').doc(buyerUid).get();
  if(!buyerSnap.exists) throw new Error('Buyer not found');
  const buyer = buyerSnap.data();
  let currentSponsorCode = buyer.sponsorCode || null;
  const commissionRecords = [];
  for(let level=0; level<BASE_COMMISSION.length; level++){
    const base = BASE_COMMISSION[level];
    // scale proportionally to planAmount / 599
    const scaled = Math.round(base * (planAmount / 599));
    const amount = Math.max(0, scaled); // ensure not negative
    if(!currentSponsorCode){
      if(amount>0) await creditAdmin(amount, buyerUid, `Level ${level+1} commission from ${buyerUid}`);
      commissionRecords.push({ level: level+1, to: 'ADMIN', amount });
      currentSponsorCode = null;
      continue;
    }
    const sponsorDoc = await findUserByReferralCode(currentSponsorCode);
    if(!sponsorDoc){
      if(amount>0) await creditAdmin(amount, buyerUid, `Level ${level+1} commission (invalid sponsor ${currentSponsorCode})`);
      commissionRecords.push({ level: level+1, to: 'ADMIN', amount });
      currentSponsorCode = null;
      continue;
    }
    const sponsorUid = sponsorDoc.uid;
    if(amount>0) await creditWalletAtomic(sponsorUid, amount, buyerUid, `Level ${level+1} commission`);
    commissionRecords.push({ level: level+1, to: sponsorUid, amount });
    currentSponsorCode = (sponsorDoc.data.sponsorCode) ? sponsorDoc.data.sponsorCode : null;
  }
  await db.collection('commissions').add({
    buyerUid,
    planAmount,
    distributedAt: firebase.firestore.FieldValue.serverTimestamp(),
    records: commissionRecords
  });
  return commissionRecords;
}

// ---------- Membership Requests ----------
async function createMembershipRequest(userUid, planKey, planPrice, name, utr, qrImageUrl = null){
  const payload = {
    userUid,
    planKey,
    planPrice,
    name: name || '',
    utr: utr || '',
    qrImageUrl: qrImageUrl || null,
    status: 'PENDING',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  const ref = await db.collection('membership_requests').add(payload);
  // optional notification doc
  await db.collection('notifications').add({ forAdmin: true, type:'MEMBERSHIP_REQUEST', requestId: ref.id, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  return ref.id;
}

async function adminApproveRequest(requestId, adminUid){
  const reqRef = db.collection('membership_requests').doc(requestId);
  const reqSnap = await reqRef.get();
  if(!reqSnap.exists) throw new Error('Request not found');
  const req = reqSnap.data();
  if(req.status !== 'PENDING') throw new Error('Request already processed');

  // mark approved
  await reqRef.update({ status: 'APPROVED', approvedBy: adminUid || null, approvedAt: firebase.firestore.FieldValue.serverTimestamp() });

  // set user's membership and plan
  const buyerUid = req.userUid;
  const userRef = db.collection('users').doc(buyerUid);
  await userRef.update({
    membership: { name: req.planKey, amount: req.planPrice, boughtAt: firebase.firestore.FieldValue.serverTimestamp() },
    plan: req.planKey
  });

  // create transaction record for the purchase (debit from user not done here because payment is external)
  await db.collection('transactions').add({
    userId: buyerUid,
    type: 'DEBIT',
    amount: req.planPrice,
    note: `Plan Purchase (${req.planKey})`,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  // distribute commissions scaled to planPrice
  const records = await distributeCommission(buyerUid, Number(req.planPrice || 0));

  // attach records to request
  await reqRef.update({ commissionRecords: records });

  return records;
}

async function adminRejectRequest(requestId, adminUid, reason=''){
  const reqRef = db.collection('membership_requests').doc(requestId);
  const reqSnap = await reqRef.get();
  if(!reqSnap.exists) throw new Error('Request not found');
  const req = reqSnap.data();
  if(req.status !== 'PENDING') throw new Error('Request already processed');
  await reqRef.update({ status: 'REJECTED', rejectedBy: adminUid || null, rejectedAt: firebase.firestore.FieldValue.serverTimestamp(), rejectReason: reason });
  return true;
}

// ---------- Admin / Reads ----------
async function getPendingMembershipRequests(limit=200){
  const snap = await db.collection('membership_requests').where('status','==','PENDING').orderBy('createdAt','asc').limit(limit).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function getAllUsers(){
  const snap = await db.collection('users').orderBy('createdAt','desc').get();
  return snap.docs.map(d=> ({ id: d.id, ...d.data() }));
}
async function getUserDoc(uid){ const d = await db.collection('users').doc(uid).get(); return d.exists ? { id: d.id, ...d.data() } : null; }
async function getAllTransactions(limit=200){
  const snap = await db.collection('transactions').orderBy('createdAt','desc').limit(limit).get();
  return snap.docs.map(d=> ({ id: d.id, ...d.data() }));
}
async function getAdminWallet(){
  const snap = await db.collection('admin').doc('company').get();
  return snap.exists ? snap.data() : { walletBalance: 0 };
}

window._NM = {
  signupUser, loginUser, logout, sendReset,
  createMembershipRequest, adminApproveRequest, adminRejectRequest,
  getPendingMembershipRequests, getAllUsers, getUserDoc,
  getAllTransactions, creditWallet, debitWallet, getAdminWallet,
  distributeCommission
};
