require('dotenv').config();
console.log('KEY_EXISTS:', !!process.env.CLERK_PUBLISHABLE_KEY);
console.log('KEY_START:', process.env.CLERK_PUBLISHABLE_KEY?.substring(0, 10));
