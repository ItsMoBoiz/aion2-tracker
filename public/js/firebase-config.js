/* Firebase settings for "Sign in with Google" and syncing on the public site.
   Paste the values from Firebase console → Project settings → Your apps → Web app → SDK setup (Config).
   These values are public by design; the Firestore security rules keep each person's data private.
   Leave apiKey empty to turn sign-in off (the app then saves in the browser only). */
window.AION2_FIREBASE = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  appId: '',

  // SHA-256 of the admin's sign-in email (lowercase), so the address itself isn't published.
  // Only this account sees "Clear all data" on the public site.
  adminEmailHashes: ['be26e581a6d2f69169b51836469151306acabf4ada2962d530c9f09c70ba46fb'],
};
