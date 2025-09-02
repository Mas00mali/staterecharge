// firebase.js (REPLACE your existing file with this exact content)
// Remember: include Firebase SDK scripts in every HTML BEFORE this file:
// <script src="https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js"></script>
// <script src="https://www.gstatic.com/firebasejs/9.22.2/firebase-auth-compat.js"></script>
// <script src="https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js"></script>

const firebaseConfig = {
  apiKey: "AIzaSyBrV_cAvH8DzoT56fd-x9FxCFeT-3PnkTM",
  authDomain: "staterecharge.firebaseapp.com",
  projectId: "staterecharge",
  storageBucket: "staterecharge.appspot.com",
  messagingSenderId: "551094745581",
  appId: "1:551094745581:web:47793c350d7358819fcfe4",
  measurementId: "G-4M6G9C3PLQ"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// ======= Helpers =======
function showMsg(id, text){
  const el = document.getElementById(id);
  if(el) el.innerText = text;
}
function redirectIfLoggedIn(to = 'dashboard.html'){
  auth.onAuthStateChanged(user => { if(user) window.location = to; });
}
function protectPage(){
  auth.onAuthStateChanged(user => { if(!user) window.location = 'index.html'; });
}
function currentUserPromise(){
  return new Promise((resolve)=>{ const unsub = auth.onAuthStateChanged(u=>{ unsub(); resolve(u); }); });
}

// ======= Signup / Login =======
async function signupUser(name, email, password, sponsorCode){
  const cred = await auth.createUserWithEmailAndPassword(email, password);
  await cred.user.updateProfile({ displayName: name || '' });
  const uid = cred.user.uid;
  const referralCode = uid.slice(0,6).toUpperCase();
  await db.collection('users').doc(uid).set({
    uid, name: name||'', email,
    sponsorCode: sponsorCode ? sponsorCode.toUpperCase() : null,
    referralCode, walletBalance: 0, kycStatus: 'PENDING', role: 'ASSOCIATE',
    membership: null, createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  if(sponsorCode){
    await db.collection('referrals').add({ sponsorCode: sponsorCode.toUpperCase(), childUid: uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  }
  return cred.user;
}
async function loginUser(email, password){ const cred = await auth.signInWithEmailAndPassword(email, password); return cred.user; }
function logout(){ auth.signOut().then(()=> window.location = 'index.html'); }
function sendReset(email){ return auth.sendPasswordResetEmail(email); }

// ======= Wallet =======
async function addMoney(uid, amount, note='Add Money (demo)'){
  amount = parseFloat(amount);
  if(isNaN(amount) || amount <= 0) throw new Error('Invalid amount');
  const userRef = db.collection('users').doc(uid);
  await userRef.update({ walletBalance: firebase.firestore.FieldValue.increment(amount) });
  await userRef.collection('walletTransactions').add({ type:'CREDIT', amount, note, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
}

// ======= Commission Engine =======
const COMMISSION_TABLE = [100,50,25,10,5]; // level1..level5

async function findUserByReferralCode(code){
  if(!code) return null;
  const q = await db.collection('users').where('referralCode','==', code.toUpperCase()).limit(1).get();
  if(q.empty) return null;
  const d = q.docs[0];
  return { id: d.id, data: d.data() };
}

async function creditWalletAtomic(targetUid, amount, fromUserUid, reason='Commission'){
  const userRef = db.collection('users').doc(targetUid);
  const txCol = userRef.collection('walletTransactions');
  await db.runTransaction(async (t) => {
    const snap = await t.get(userRef);
    if(!snap.exists) throw new Error('User not found for credit');
    t.update(userRef, { walletBalance: firebase.firestore.FieldValue.increment(amount) });
    t.set(txCol.doc(), { type:'CREDIT', amount, note:`${reason} from ${fromUserUid}`, from: fromUserUid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  });
}

async function creditAdmin(amount, fromUserUid, reason='Commission (unassigned)'){
  const adminRef = db.collection('admin').doc('company');
  await db.runTransaction(async (t) => {
    const snap = await t.get(adminRef);
    if(!snap.exists){
      t.set(adminRef, { walletBalance: amount });
      t.set(adminRef.collection('txs').doc(), { type:'CREDIT', amount, note: reason, from: fromUserUid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    } else {
      t.update(adminRef, { walletBalance: firebase.firestore.FieldValue.increment(amount) });
      t.set(adminRef.collection('txs').doc(), { type:'CREDIT', amount, note: reason, from: fromUserUid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    }
  });
}

async function distributeCommission(buyerUid){
  const buyerSnap = await db.collection('users').doc(buyerUid).get();
  if(!buyerSnap.exists) throw new Error('Buyer not found');
  const buyer = buyerSnap.data();
  let currentSponsorCode = buyer.sponsorCode || null;
  const commissionRecords = [];
  for(let level=0; level<COMMISSION_TABLE.length; level++){
    const amount = COMMISSION_TABLE[level];
    if(!currentSponsorCode){
      await creditAdmin(amount, buyerUid, `Level ${level+1} commission from ${buyerUid}`);
      commissionRecords.push({ level: level+1, to: 'ADMIN', amount });
      currentSponsorCode = null;
      continue;
    }
    const sponsorDoc = await findUserByReferralCode(currentSponsorCode);
    if(!sponsorDoc){
      await creditAdmin(amount, buyerUid, `Level ${level+1} commission (invalid sponsor ${currentSponsorCode})`);
      commissionRecords.push({ level: level+1, to: 'ADMIN', amount });
      currentSponsorCode = null;
      continue;
    }
    const sponsorUid = sponsorDoc.id;
    await creditWalletAtomic(sponsorUid, amount, buyerUid, `Level ${level+1} commission`);
    commissionRecords.push({ level: level+1, to: sponsorUid, amount });
    currentSponsorCode = (sponsorDoc.data.sponsorCode) ? sponsorDoc.data.sponsorCode : null;
  }
  await db.collection('commissions').add({ buyerUid, distributedAt: firebase.firestore.FieldValue.serverTimestamp(), records: commissionRecords });
  return commissionRecords;
}

// ======= Membership purchase (marks user membership & distribute) =======
async function purchaseMembership(buyerUid, planName='MEMBERSHIP 599', planAmount=599){
  const userRef = db.collection('users').doc(buyerUid);
  await userRef.update({ membership: { name: planName, amount: planAmount, boughtAt: firebase.firestore.FieldValue.serverTimestamp() } });
  const records = await distributeCommission(buyerUid);
  return records;
}

// ======= Membership request flow (UTR submission) =======
async function createMembershipRequest(userUid, name, utr, qrImageUrl = null){
  const payload = {
    userUid,
    name: name || '',
    utr: utr || '',
    qrImageUrl: qrImageUrl || null,
    status: 'PENDING',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  const ref = await db.collection('membership_requests').add(payload);
  await db.collection('notifications').add({ forAdmin: true, type:'MEMBERSHIP_REQUEST', requestId: ref.id, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  return ref.id;
}

async function adminApproveRequest(requestId, adminUid){
  const reqRef = db.collection('membership_requests').doc(requestId);
  const reqSnap = await reqRef.get();
  if(!reqSnap.exists) throw new Error('Request not found');
  const req = reqSnap.data();
  if(req.status !== 'PENDING') throw new Error('Request already processed');

  await reqRef.update({ status: 'APPROVED', approvedBy: adminUid || null, approvedAt: firebase.firestore.FieldValue.serverTimestamp() });

  const buyerUid = req.userUid;
  const records = await purchaseMembership(buyerUid, 'MEMBERSHIP 599', 599);

  await reqRef.update({ commissionRecords: records });
  return records;
}

async function adminRejectRequest(requestId, adminUid, reason = ''){
  const reqRef = db.collection('membership_requests').doc(requestId);
  const reqSnap = await reqRef.get();
  if(!reqSnap.exists) throw new Error('Request not found');
  const req = reqSnap.data();
  if(req.status !== 'PENDING') throw new Error('Request already processed');
  await reqRef.update({ status: 'REJECTED', rejectedBy: adminUid || null, rejectedAt: firebase.firestore.FieldValue.serverTimestamp(), rejectReason: reason });
  return true;
}

// ======= Admin reads =======
async function getPendingMembershipRequests(limit = 100){
  const snap = await db.collection('membership_requests').where('status','==','PENDING').orderBy('createdAt','asc').limit(limit).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function getAllRequests(limit = 200){
  const snap = await db.collection('membership_requests').orderBy('createdAt','desc').limit(limit).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function getAllUsers(){ const snap = await db.collection('users').orderBy('createdAt','desc').get(); return snap.docs.map(d=> ({ id: d.id, ...d.data() })); }
async function getAdminWallet(){ const snap = await db.collection('admin').doc('company').get(); return snap.exists ? snap.data() : { walletBalance: 0 }; }
async function getAllCommissions(limit=50){ const snap = await db.collection('commissions').orderBy('distributedAt','desc').limit(limit).get(); return snap.docs.map(d=> ({ id: d.id, ...d.data() })); }
async function getUserDoc(uid){ const d = await db.collection('users').doc(uid).get(); return d.exists ? { id: d.id, ...d.data() } : null; }

// Export
window._NM = {
  signupUser, loginUser, logout, sendReset, addMoney, createMembershipRequest,
  getPendingMembershipRequests, adminApproveRequest, adminRejectRequest,
  getAllRequests, getAllUsers, getAdminWallet, getAllCommissions,
  getUserDoc, currentUserPromise, purchaseMembership, distributeCommission
};
